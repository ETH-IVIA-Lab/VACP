# Copyright 2025 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from __future__ import annotations

import logging
import os
import time
from typing import Any, Literal

import termcolor
from google import genai
from google.genai import types
from google.genai.types import Candidate, Content, FinishReason, FunctionResponse, GenerateContentConfig, Part
from rich.console import Console
from rich.table import Table

from .computers import Computer, EnvState

MAX_RECENT_TURN_WITH_SCREENSHOTS = 3
PREDEFINED_COMPUTER_USE_FUNCTIONS = [
    'open_web_browser',
    'click_at',
    'hover_at',
    'type_text_at',
    'scroll_document',
    'scroll_at',
    'wait_5_seconds',
    'go_back',
    'go_forward',
    'search',
    'navigate',
    'key_combination',
    'drag_and_drop',
]

console = Console()
logger = logging.getLogger(__name__)

# Built-in Computer Use tools will return `EnvState`.
# Custom provided functions will return `dict`.
FunctionResponseT = EnvState | dict[str, Any]


def multiply_numbers(x: float, y: float) -> dict[str, float]:
    """Multiplies two numbers."""

    return {'result': x * y}


class BrowserAgent:
    def __init__(
        self,
        browser_computer: Computer,
        query: str,
        model_name: str,
        verbose: bool = True,
        auto_confirm_safety: bool = False,
    ):
        self._browser_computer = browser_computer
        self._query = query
        self._model_name = model_name
        self._verbose = verbose
        self._auto_confirm_safety = auto_confirm_safety
        self.final_reasoning: str | None = None

        self._client = genai.Client(
            api_key=os.environ.get('GEMINI_API_KEY'),
            vertexai=os.environ.get('USE_VERTEXAI', '0').lower() in ['true', '1'],
            project=os.environ.get('VERTEXAI_PROJECT'),
            location=os.environ.get('VERTEXAI_LOCATION'),
        )
        self._contents: list[Content] = [
            Content(
                role='user',
                parts=[
                    Part(text=self._query),
                ],
            )
        ]

        # Exclude any predefined functions here.
        excluded_predefined_functions: list[str] = []

        # Add your own custom functions here.
        custom_functions = [
            # For example:
            types.FunctionDeclaration.from_callable(client=self._client._api_client, callable=multiply_numbers)
        ]

        self._generate_content_config = GenerateContentConfig(
            temperature=1,
            top_p=0.95,
            top_k=40,
            max_output_tokens=8192,
            tools=[
                types.Tool(
                    computer_use=types.ComputerUse(
                        environment=types.Environment.ENVIRONMENT_BROWSER,
                        excluded_predefined_functions=excluded_predefined_functions,
                    ),
                ),
                types.Tool(function_declarations=custom_functions),
            ],
            thinking_config=types.ThinkingConfig(include_thoughts=True),
        )

    def handle_action(self, action: types.FunctionCall) -> FunctionResponseT:
        """Handles the action and returns the environment state."""

        def require_args() -> dict[str, Any]:
            if action.args is None:
                raise ValueError(f'Missing args for function: {action.name}')
            return action.args

        if action.name == 'open_web_browser':
            return self._browser_computer.open_web_browser()
        if action.name == 'click_at':
            args = require_args()
            x = self.denormalize_x(args['x'])
            y = self.denormalize_y(args['y'])
            return self._browser_computer.click_at(
                x=x,
                y=y,
            )
        if action.name == 'hover_at':
            args = require_args()
            x = self.denormalize_x(args['x'])
            y = self.denormalize_y(args['y'])
            return self._browser_computer.hover_at(
                x=x,
                y=y,
            )
        if action.name == 'type_text_at':
            args = require_args()
            x = self.denormalize_x(args['x'])
            y = self.denormalize_y(args['y'])
            press_enter = args.get('press_enter', False)
            clear_before_typing = args.get('clear_before_typing', True)
            return self._browser_computer.type_text_at(
                x=x,
                y=y,
                text=args['text'],
                press_enter=press_enter,
                clear_before_typing=clear_before_typing,
            )
        if action.name == 'scroll_document':
            args = require_args()
            return self._browser_computer.scroll_document(args['direction'])
        if action.name == 'scroll_at':
            args = require_args()
            x = self.denormalize_x(args['x'])
            y = self.denormalize_y(args['y'])
            magnitude = args.get('magnitude', 800)
            direction = args['direction']

            if direction in ('up', 'down'):
                magnitude = self.denormalize_y(magnitude)
            elif direction in ('left', 'right'):
                magnitude = self.denormalize_x(magnitude)
            else:
                raise ValueError('Unknown direction: ', direction)
            return self._browser_computer.scroll_at(x=x, y=y, direction=direction, magnitude=magnitude)
        if action.name == 'wait_5_seconds':
            return self._browser_computer.wait_5_seconds()
        if action.name == 'go_back':
            return self._browser_computer.go_back()
        if action.name == 'go_forward':
            return self._browser_computer.go_forward()
        if action.name == 'search':
            return self._browser_computer.search()
        if action.name == 'navigate':
            args = require_args()
            return self._browser_computer.navigate(args['url'])
        if action.name == 'key_combination':
            args = require_args()
            return self._browser_computer.key_combination(args['keys'].split('+'))
        if action.name == 'drag_and_drop':
            args = require_args()
            x = self.denormalize_x(args['x'])
            y = self.denormalize_y(args['y'])
            destination_x = self.denormalize_x(args['destination_x'])
            destination_y = self.denormalize_y(args['destination_y'])
            return self._browser_computer.drag_and_drop(
                x=x,
                y=y,
                destination_x=destination_x,
                destination_y=destination_y,
            )
        # Handle the custom function declarations here.
        if action.name == multiply_numbers.__name__:
            args = require_args()
            return multiply_numbers(x=args['x'], y=args['y'])
        raise ValueError(f'Unsupported function: {action}')

    def get_model_response(self, max_retries: int = 5, base_delay_s: float = 1) -> types.GenerateContentResponse:
        if max_retries < 1:
            raise ValueError('max_retries must be >= 1')
        for attempt in range(max_retries):
            try:
                response = self._client.models.generate_content(
                    model=self._model_name,
                    contents=self._contents,
                    config=self._generate_content_config,
                )
                return response  # Return response on success
            except Exception as e:
                print(e)
                if attempt < max_retries - 1:
                    delay = base_delay_s * (2**attempt)
                    message = f'Generating content failed on attempt {attempt + 1}. Retrying in {delay} seconds...\n'
                    termcolor.cprint(
                        message,
                        color='yellow',
                    )
                    time.sleep(delay)
                else:
                    termcolor.cprint(
                        f'Generating content failed after {max_retries} attempts.\n',
                        color='red',
                    )
                    raise
        raise RuntimeError('Unreachable: retries exhausted without return')

    def get_text(self, candidate: Candidate) -> str | None:
        """Extracts the text from the candidate."""

        if not candidate.content or not candidate.content.parts:
            return None
        text: list[str] = []
        for part in candidate.content.parts:
            if part.text:
                text.append(part.text)
        return ' '.join(text) or None

    def extract_function_calls(self, candidate: Candidate) -> list[types.FunctionCall]:
        """Extracts the function call from the candidate."""

        if not candidate.content or not candidate.content.parts:
            return []
        ret: list[types.FunctionCall] = []
        for part in candidate.content.parts:
            if part.function_call:
                ret.append(part.function_call)
        return ret

    def run_one_iteration(self) -> Literal['COMPLETE', 'CONTINUE']:
        # Generate a response from the model.
        if self._verbose:
            with console.status('Generating response from Gemini Computer Use...'):
                try:
                    response = self.get_model_response()
                except Exception:
                    return 'COMPLETE'
        else:
            try:
                response = self.get_model_response()
            except Exception:
                return 'COMPLETE'

        if not response.candidates:
            print('Response has no candidates!')
            print(response)
            raise ValueError('Empty response')

        # Extract the text and function call from the response.
        candidate = response.candidates[0]
        # Append the model turn to conversation history.
        if candidate.content:
            self._contents.append(candidate.content)

        reasoning = self.get_text(candidate)
        function_calls = self.extract_function_calls(candidate)

        # Retry the request in case of malformed FCs.
        if not function_calls and not reasoning and candidate.finish_reason == FinishReason.MALFORMED_FUNCTION_CALL:
            return 'CONTINUE'

        if not function_calls:
            print(f'Agent Loop Complete: {reasoning}')
            self.final_reasoning = reasoning
            return 'COMPLETE'

        function_call_strs: list[str] = []
        for function_call in function_calls:
            # Print the function call and any reasoning.
            function_call_str = f'Name: {function_call.name}'
            if function_call.args:
                function_call_str += '\nArgs:'
                for key, value in function_call.args.items():
                    function_call_str += f'\n  {key}: {value}'
            function_call_strs.append(function_call_str)

        table = Table(expand=True)
        table.add_column('Gemini Computer Use Reasoning', header_style='magenta', ratio=1)
        table.add_column('Function Call(s)', header_style='cyan', ratio=1)
        table.add_row(reasoning or '', '\n'.join(function_call_strs))
        if self._verbose:
            console.print(table)
            print()

        function_responses: list[FunctionResponse] = []
        for function_call in function_calls:
            extra_fr_fields: dict[str, str] = {}
            if function_call.args and (safety := function_call.args.get('safety_decision')):
                decision = self._get_safety_confirmation(safety)
                if decision == 'TERMINATE':
                    print('Terminating agent loop')
                    return 'COMPLETE'
                # Explicitly mark the safety check as acknowledged.
                extra_fr_fields['safety_acknowledgement'] = 'true'
            if self._verbose:
                with console.status('Sending command to Computer...'):
                    fc_result = self.handle_action(function_call)
            else:
                fc_result = self.handle_action(function_call)
            if isinstance(fc_result, EnvState):
                function_responses.append(
                    FunctionResponse(
                        name=function_call.name,
                        response={
                            'url': fc_result.url,
                            **extra_fr_fields,
                        },
                        parts=[
                            types.FunctionResponsePart(
                                inline_data=types.FunctionResponseBlob(mime_type='image/png', data=fc_result.screenshot)
                            )
                        ],
                    )
                )
            elif isinstance(fc_result, dict):
                function_responses.append(FunctionResponse(name=function_call.name, response=fc_result))

        self._contents.append(
            Content(
                role='user',
                parts=[Part(function_response=fr) for fr in function_responses],
            )
        )

        # Only keep screenshots in the few most recent turns; remove the screenshot images from the old turns.
        turn_with_screenshots_found = 0
        for content in reversed(self._contents):
            if content.role == 'user' and content.parts:
                # Check if content has screenshot of the predefined computer use functions.
                has_screenshot = False
                for part in content.parts:
                    if (
                        part.function_response
                        and part.function_response.parts
                        and part.function_response.name in PREDEFINED_COMPUTER_USE_FUNCTIONS
                    ):
                        has_screenshot = True
                        break

                if has_screenshot:
                    turn_with_screenshots_found += 1
                    # Remove the screenshot image if the number of screenshots exceed the limit.
                    if turn_with_screenshots_found > MAX_RECENT_TURN_WITH_SCREENSHOTS:
                        for part in content.parts:
                            if (
                                part.function_response
                                and part.function_response.parts
                                and part.function_response.name in PREDEFINED_COMPUTER_USE_FUNCTIONS
                            ):
                                part.function_response.parts = []

        return 'CONTINUE'

    def _get_safety_confirmation(self, safety: dict[str, Any]) -> Literal['CONTINUE', 'TERMINATE']:
        if safety['decision'] != 'require_confirmation':
            raise ValueError("Unknown safety decision: safety['decision']")

        if self._auto_confirm_safety:
            message = (
                'Safety service requested confirmation, but auto-confirm is enabled; proceeding without prompting.'
            )
            logger.warning(message)
            termcolor.cprint(
                message,
                color='yellow',
                attrs=['bold'],
            )
            explanation = safety.get('explanation')
            if explanation:
                print(explanation)
            return 'CONTINUE'

        termcolor.cprint(
            'Safety service requires explicit confirmation!',
            color='yellow',
            attrs=['bold'],
        )
        print(safety['explanation'])
        decision = ''
        while decision.lower() not in ('y', 'n', 'ye', 'yes', 'no'):
            decision = input('Do you wish to proceed? [Yes]/[No]\n')
        if decision.lower() in ('n', 'no'):
            return 'TERMINATE'
        return 'CONTINUE'

    def agent_loop(self, *, max_steps: int | None = None) -> None:
        """Run the agent until completion or a step limit is hit.

        `max_steps=None` means run indefinitely.
        """

        if max_steps is not None and max_steps < 1:
            raise ValueError('max_steps must be >= 1, or None for unlimited')

        status: Literal['COMPLETE', 'CONTINUE'] = 'CONTINUE'
        steps = 0
        while status == 'CONTINUE':
            if max_steps is not None and steps >= max_steps:
                message = f'Max steps reached ({max_steps}); stopping agent loop.'
                logger.warning(message)
                termcolor.cprint(message, color='yellow', attrs=['bold'])
                self.final_reasoning = f'Stopped after reaching max_steps={max_steps}.'
                return
            status = self.run_one_iteration()
            steps += 1

    def denormalize_x(self, x: int) -> int:
        return int(x / 1000 * self._browser_computer.screen_size()[0])

    def denormalize_y(self, y: int) -> int:
        return int(y / 1000 * self._browser_computer.screen_size()[1])
