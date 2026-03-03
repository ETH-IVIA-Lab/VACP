# /// script
# dependencies = [
#     "altair==6.0.0",
#     "duckdb==1.4.4",
#     "marimo",
#     "polars==1.38.1",
#     "pyarrow==23.0.1",
#     "pydantic-ai==1.62.0",
#     "sqlglot==28.10.1",
# ]
# requires-python = ">=3.13"
# ///

import marimo

__generated_with = "0.20.2"
app = marimo.App(width="columns")


@app.cell(column=0, hide_code=True)
def _(mo):
    mo.md(r"""
    # Analysis
    """)
    return


@app.cell(hide_code=True)
def _(mo, states_df):
    turns = mo.sql(
        f"""
        SELECT
          DENSE_RANK() OVER (
            ORDER BY runs_started_at, experiment, scenario_id, model_provider, model_name
          ) AS run_id,
          *
        FROM states_df;
        """,
        output=False
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## How are state transitions distributed? (Markov Analysis)
    """)
    return


@app.cell(hide_code=True)
def _(SOLVED_LABEL_MAP, alt, markov_df, mo, pl, with_nice_labels):
    def create_markov_chart(df: pl.DataFrame) -> alt.Chart:
        return (
            alt.Chart(with_nice_labels(df))
            .mark_rect()
            .encode(
                x=alt.X('current_state', title='Current State'),
                y=alt.Y('next_state', title='Next State'),
                color=alt.Color(
                    'transition_probability_pct',
                    title='Transition Probability (%)',
                ),
                column=alt.Column('model_name', title='Model'),
                row=alt.Row('experiment', title='Experiment'),
                tooltip=[
                    alt.Tooltip('experiment', title='Experiment'),
                    alt.Tooltip('model_name', title='Model'),
                    alt.Tooltip('solved', title='Outcome'),
                    alt.Tooltip('current_state', title='Current State'),
                    alt.Tooltip('next_state', title='Next State'),
                    alt.Tooltip('transition_count', title='Transition Count'),
                    alt.Tooltip(
                        'transition_probability_pct',
                        title='Transition Probability (%)',
                    ),
                ],
            )
            .properties(width=200, height=200)
        )


    charts = [
        mo.vstack(
            [
                mo.md(f'**Outcome: {SOLVED_LABEL_MAP.get(solved)}**'),
                create_markov_chart(markov_df.filter(solved=solved)),
            ],
            align='center',
        )
        for solved in SOLVED_LABEL_MAP
    ]
    mo.hstack(charts)
    return


@app.cell(hide_code=True)
def _(mo, states_df):
    markov_df = mo.sql(
        f"""
        WITH
            runs_with_id AS (
                -- Step 1: Assign a unique run_id and carry the key partitioning columns forward.
                SELECT
                    DENSE_RANK () OVER (
                        ORDER BY
                            runs_started_at,
                            experiment,
                            scenario_id,
                            model_name
                    ) AS run_id,
                    experiment,
                    model_name,
                    turn,
                    stratum,
                    phase,
                    -- Propagate the 'solved' status for the entire run to each of its turns.
                    BOOL_OR(solved) OVER (
                        PARTITION BY
                            runs_started_at,
                            experiment,
                            scenario_id,
                            model_name
                    ) AS solved_status
                FROM
                    states_df -- Your flattened DataFrame
            ),
            state_transitions AS (
                -- Step 2: Use LEAD() to find the next state, partitioned by the unique run_id.
                SELECT
                    run_id,
                    experiment,
                    model_name,
                    solved_status,
                    stratum || '-' || phase AS current_state,
                    LEAD (stratum || '-' || phase) OVER (
                        PARTITION BY
                            run_id
                        ORDER BY
                            turn
                    ) AS next_state
                FROM
                    runs_with_id
            )
            -- Final Aggregation: Count transitions and calculate probabilities, now partitioned by experiment, model, and solved status.
        SELECT
            experiment,
            model_name,
            solved_status AS solved,
            current_state,
            next_state,
            COUNT(*) AS transition_count,
            ROUND(
                COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (
                    PARTITION BY
                        experiment,
                        model_name, -- Added model_name
                        solved,
                        current_state
                ),
                2
            ) AS transition_probability_pct
        FROM
            state_transitions
        WHERE
            next_state IS NOT NULL
        GROUP BY
            experiment,
            model_name,
            solved,
            current_state,
            next_state
        HAVING
            transition_count > 0 -- Lowered threshold to see even single transitions for rare models/outcomes
        ORDER BY
            experiment,
            model_name,
            solved,
            current_state,
            transition_count DESC;
        """,
        output=False
    )
    return (markov_df,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## How did different models adapt their approach on intermittent failures?
    """)
    return


@app.cell(hide_code=True)
def _(alt, failure_adaption_df, with_nice_labels):
    alt.Chart(with_nice_labels(failure_adaption_df)).mark_bar().encode(
        x=alt.X(
            'sum(shift_pct)',
            title='% of shifts on failure',
            scale=alt.Scale(domain=[0, 100]),
        ),
        y=alt.Y(
            'model_name',
            title='Model',
        ),
        color=alt.Color('shift', title='Reaction Shift'),
        column=alt.Column('solved', title='Outcome'),
        row=alt.Row('experiment', title='Experiment'),
        order=alt.Order('shift'),
        tooltip=[
            alt.Tooltip('experiment', title='Experiment'),
            alt.Tooltip('model_name', title='Model'),
            alt.Tooltip('shift', title='Reaction Shift'),
            alt.Tooltip('shift_pct', title='% of shifts on failure'),
        ],
    ).properties(width=360)
    return


@app.cell(hide_code=True)
def _(mo, states_df):
    failure_adaption_df = mo.sql(
        f"""
        WITH 
            runs_with_id AS (
                -- Step 1: Assign a unique ID to each individual experimental run. This is essential for correct window function partitioning.
                SELECT 
                    DENSE_RANK() OVER (
                        ORDER BY runs_started_at, experiment, scenario_id, model_name
                    ) AS run_id,
                    solved,
                    turn,
                    outcome,
                    shift,
                    experiment,
                    model_name
                FROM states_df
            ),
            failure_reactions AS (
                -- Step 2: For each turn, find the 'shift' of the *next* turn within the same run.
                SELECT 
                    run_id,
                    model_name,
                    experiment,
                    solved,
                    outcome,
                    -- The 'reaction_shift' is the agent's strategic pivot on the turn immediately following a failure.
                    LEAD(shift) OVER (PARTITION BY run_id ORDER BY turn) AS reaction_shift
                FROM runs_with_id
            )
        -- Final Aggregation: Count the types of shifts that follow failures, and partition by success status.
        SELECT 
            experiment,
            model_name,
            solved,         -- The key dimension for comparison
            reaction_shift AS shift,
            COUNT(*) AS shift_count,
            -- Calculate the percentage of this shift type for this specific group (e.g., all SOLVED baseline GPT failures)
            ROUND(
                COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (
                    PARTITION BY 
                        experiment, 
                        model_name, 
                        solved
                ), 
                2
            ) AS shift_pct
        FROM failure_reactions
        WHERE 
            outcome IN ('FLA', 'FEX') -- We only care about what happens *after* a failure
            AND reaction_shift IS NOT NULL
        GROUP BY 
            experiment, 
            model_name, 
            solved,
            reaction_shift
        ORDER BY 
            experiment, 
            model_name, 
            solved,
            shift_count DESC;
        """,
        output=False
    )
    return (failure_adaption_df,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## In which Stratum do different agens spend their time?
    """)
    return


@app.cell(hide_code=True)
def _(alt, stratum_pct_df, with_nice_labels):
    alt.Chart(with_nice_labels(stratum_pct_df)).mark_bar().encode(
        x=alt.X(
            'sum(pct_in_stratum)',
            title='% of states in stratum',
            scale=alt.Scale(domain=[0, 100]),
        ),
        y=alt.Y(
            'model_name',
            title='Model',
        ),
        color=alt.Color('stratum'),
        column=alt.Column('solved', title='Outcome'),
        row=alt.Row('experiment', title='Experiment'),
        order=alt.Order('stratum'),
        tooltip=[
            alt.Tooltip('experiment', title='Experiment'),
            alt.Tooltip('model_name', title='Model'),
            alt.Tooltip('stratum', title='Stratum'),
            alt.Tooltip('pct_in_stratum', title='% in Stratum'),
        ],
    ).properties(width=360)
    return


@app.cell(hide_code=True)
def _(mo, states_df):
    stratum_pct_df = mo.sql(
        f"""
        SELECT 
            experiment,
            model_name,
            solved,         -- The dimension we are partitioning by
            stratum,
            COUNT(*) AS turn_count,
            -- The percentage of turns in this stratum for this specific group (e.g., for all SOLVED baseline GPT runs)
            ROUND(
                COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (
                    PARTITION BY 
                        experiment, 
                        model_name, 
                        solved -- This is the key change.
                ), 
                2
            ) AS pct_in_stratum
        FROM 
            states_df
        GROUP BY 
            experiment, 
            model_name, 
            solved,
            stratum
        ORDER BY 
            experiment, 
            model_name, 
            solved,      -- Ordering by 'solved' makes the output easy to compare
            pct_in_stratum DESC;
        """,
        output=False
    )
    return (stratum_pct_df,)


@app.cell(column=1, hide_code=True)
def _(mo):
    mo.md(r"""
    # Datasets
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Agent State Transitions

    Dataframe capturing each session as a list of states in a unified state space.
    """)
    return


@app.cell(hide_code=True)
def _(STATES_FILES, json, pl, runs_df):
    states_df = (
        pl.from_dicts(
            [
                {'path': str(p), 'states': json.loads(p.read_text())}
                for p in STATES_FILES
            ],
            strict=False,
        )
        .select(
            runs_started_at=pl.col('path')
            .str.extract(r'(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)')
            .str.replace('-\d{3}Z', '')
            .str.to_datetime('%Y-%m-%dT%H-%M-%S', time_zone='UTC'),
            experiment=pl.col('path').str.extract(r'/experiment=(.+)/scenario'),
            scenario_id=pl.col('path').str.extract(
                r'/scenario=(.+)/modelProvider'
            ),
            model_provider=pl.col('path').str.extract(
                r'/modelProvider=(.+)/modelName'
            ),
            model_name=pl.col('path').str.extract(r'/modelName=(.+)/states.json'),
            states='states',
        )
        .join(
            runs_df.select(
                'runs_started_at',
                'experiment',
                'scenario_id',
                'model_provider',
                'model_name',
                'solved',
            ),
            on=[
                'runs_started_at',
                'experiment',
                'scenario_id',
                'model_provider',
                'model_name',
            ],
        )
        .explode('states')
        .unnest('states')
    )
    states_df
    return (states_df,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Run Metadata

    Dataframe of metadata for each run, including token usage, outcomes and other metrics.
    """)
    return


@app.cell(hide_code=True)
def _(RUNS_ROOT, RUN_FILES, json, pl):
    runs_df = (
        (
            pl.from_dicts(
                [
                    {
                        'path': str(p),
                        'runs': json.loads(p.read_text()),
                    }
                    for p in RUN_FILES
                ],
                strict=False,
            )
            .select(
                runs_started_at=pl.col('path')
                .str.replace(str(RUNS_ROOT.absolute()), '')
                .str.split('/')
                .list.get(1)
                .str.replace('-\d{3}Z', '')
                .str.to_datetime('%Y-%m-%dT%H-%M-%S', time_zone='UTC'),
                runs='runs',
            )
            .explode('runs')
            .unnest('runs')
        )
        .with_columns(
            model_name=pl.col('model_name').str.replace(':', '-'),
            solved=(pl.col('solved_strict') | pl.col('solved_semantic')).fill_null(
                False
            ),
        )
    )
    runs_df
    return (runs_df,)


@app.cell(hide_code=True)
def _():
    MODEL_LABEL_MAP = {
        'anthropic.claude-sonnet-4-5-20250929-v1-0': 'Claude Sonnet 4.5',
        'gemini-3-pro-preview': 'Gemini 3 Pro',
        'gpt-5.2': 'GPT 5.2',
    }
    STRATUM_LABEL_MAP = {
        'SEM': 'Semantic',
        'SYN': 'Syntactic',
        'PRG': 'Pragmatic',
    }
    EXPERIMENT_LABEL_MAP = {
        'baseline': 'UI + DOM',
        'with-snapshot': 'UI + DOM + State',
        'pure-vacp': 'VACP',
        'full-toolkit': 'VACP + UI + DOM',
    }
    SHIFT_LABEL_MAP = {
        'LAD': 'Ascend',
        'DES': 'Descend',
        'STA': 'Stagnate',
    }
    SOLVED_LABEL_MAP = {
        'true': '✅ Solved',
        'false': '❌ Failed',
    }
    LABEL_MAPS = {
        'model_name': MODEL_LABEL_MAP,
        'stratum': STRATUM_LABEL_MAP,
        'experiment': EXPERIMENT_LABEL_MAP,
        'shift': SHIFT_LABEL_MAP,
        'solved': SOLVED_LABEL_MAP,
    }
    return LABEL_MAPS, SOLVED_LABEL_MAP


@app.cell(hide_code=True)
def _(LABEL_MAPS, pl):
    def with_nice_labels(df: pl.DataFrame) -> pl.DataFrame:
        res_df = df.clone()
        for colname, label_map in LABEL_MAPS.items():
            if colname in res_df.columns:
                res_df = res_df.with_columns(pl.col(colname).cast(pl.String).replace(label_map))

        return res_df

    return (with_nice_labels,)


@app.cell(hide_code=True)
def _(ARENA_ROOT, RUNS_ROOT):
    RUN_PATH_MAP = {
        '-'.join(str(d).split('/')[-1].split('-')[:-1]): str(
            d.relative_to(ARENA_ROOT)
        )
        for d in RUNS_ROOT.glob('*')
        if d.is_dir()
    }
    return


@app.cell(hide_code=True)
def _(pathlib):
    ARENA_ROOT = pathlib.Path(__file__).parent.parent
    RUNS_ROOT = ARENA_ROOT / '.agent-arena' / 'runs'
    RUN_FILES = sorted(RUNS_ROOT.glob('*/analysis/datasets/runs_normalized.json'))
    STATES_FILES = sorted(RUNS_ROOT.glob('*/runs/*/*/*/*/states.json'))
    return ARENA_ROOT, RUNS_ROOT, RUN_FILES, STATES_FILES


@app.cell(hide_code=True)
def _():
    import marimo as mo
    import polars as pl
    import pathlib
    import json
    import re
    import altair as alt

    return alt, json, mo, pathlib, pl


if __name__ == "__main__":
    app.run()
