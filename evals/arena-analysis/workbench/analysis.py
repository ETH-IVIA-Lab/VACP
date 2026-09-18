import marimo

__generated_with = '0.20.2'
app = marimo.App(width='columns')

with app.setup:
    from altair import Chart
    from polars import DataFrame


@app.cell(column=0, hide_code=True)
def _(mo):
    mo.md(r"""
    # Analysis
    """)
    return


@app.cell(hide_code=True)
def _(mo, states_df):
    mo.sql(
        """
        SELECT
          DENSE_RANK() OVER (
            ORDER BY run_id, experiment, scenario_id, model_provider, model_name
          ) AS session_id,
          *
        FROM states_df;
        """,
        output=False,
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## How are state transitions distributed? (Markov Analysis)
    """)
    return


@app.cell(hide_code=True)
def _(SOLVED_LABEL_MAP, SOLVED_ORDER, alt, markov_df, mo, with_nice_labels):

    def create_markov_chart(df: DataFrame) -> Chart:
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
        for solved in SOLVED_ORDER
    ]
    mo.hstack(charts)
    return


@app.cell(hide_code=True)
def _(mo, states_df):
    markov_df = mo.sql(
        """
        WITH
            runs_with_id AS (
                -- Assign a stable session_id and carry partition columns forward.
                SELECT
                    DENSE_RANK () OVER (
                        ORDER BY
                            run_id,
                            experiment,
                            scenario_id,
                            model_name
                    ) AS session_id,
                    run_id,
                    experiment,
                    model_name,
                    turn,
                    stratum,
                    phase,
                    -- Propagate the 'solved' status for the entire run to each of its turns.
                    BOOL_OR(solved) OVER (
                        PARTITION BY
                            run_id,
                            experiment,
                            scenario_id,
                            model_name
                    ) AS solved_status
                FROM
                    states_df
            ),
            state_transitions AS (
                -- Use LEAD() to derive the next state within each session.
                SELECT
                    session_id,
                    experiment,
                    model_name,
                    solved_status,
                    stratum || '-' || phase AS current_state,
                    LEAD (stratum || '-' || phase) OVER (
                        PARTITION BY
                            session_id
                        ORDER BY
                            turn
                    ) AS next_state
                FROM
                    runs_with_id
            )
            -- Count transition probabilities by experiment, model, and solved status.
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
            transition_count > 0 -- Include rare model and outcome transitions.
        ORDER BY
            experiment,
            model_name,
            solved,
            current_state,
            transition_count DESC;
        """,
        output=False,
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
        """
        WITH 
            runs_with_id AS (
                -- Assign one ID per experimental run for window function partitioning.
                SELECT 
                    DENSE_RANK() OVER (
                        ORDER BY run_id, experiment, scenario_id, model_name
                    ) AS session_id,
                    run_id,
                    solved,
                    turn,
                    outcome,
                    shift,
                    experiment,
                    model_name
                FROM states_df
            ),
            failure_reactions AS (
                -- For each turn, find the next strategic shift within the same run.
                SELECT 
                    session_id,
                    model_name,
                    experiment,
                    solved,
                    outcome,
                    -- reaction_shift is the strategic pivot immediately after a failure.
                    LEAD(shift) OVER (PARTITION BY session_id ORDER BY turn) AS reaction_shift
                FROM runs_with_id
            )
        -- Count shift types after failures and partition them by success status.
        SELECT 
            experiment,
            model_name,
            solved,
            reaction_shift AS shift,
            COUNT(*) AS shift_count,
            -- Calculate each shift type as a percentage of the current group.
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
            outcome IN ('FLA', 'FEX')
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
        output=False,
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
        """
        SELECT 
            experiment,
            model_name,
            solved,
            stratum,
            COUNT(*) AS turn_count,
            -- Calculate this stratum percentage within each experiment, model, and solve status.
            ROUND(
                COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (
                    PARTITION BY 
                        experiment, 
                        model_name, 
                        solved
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
            solved,
            pct_in_stratum DESC;
        """,
        output=False,
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
            [{'path': str(p), 'states': json.loads(p.read_text())} for p in STATES_FILES],
            strict=False,
        )
        .select(
            run_id=pl.col('path').str.extract(r'/\.agent-arena/runs/([^/]+)/runs/'),
            experiment=pl.col('path').str.extract(r'/experiment=([^/]+)/scenario='),
            scenario_id=pl.col('path').str.extract(r'/scenario=([^/]+)/modelProvider='),
            model_provider=pl.col('path').str.extract(r'/modelProvider=([^/]+)/modelName='),
            model_name=pl.col('path').str.extract(r'/modelName=([^/]+)/(?:attempts/[^/]+/)?states\.json'),
            attempt_id=pl.col('path').str.extract(r'/attempts/([^/]+)/states\.json'),
            is_attempt=pl.col('path').str.contains('/attempts/'),
            states='states',
        )
        .join(
            runs_df.select(
                'run_id',
                'experiment',
                'scenario_id',
                'model_provider',
                'model_name',
                'solved',
            ),
            on=[
                'run_id',
                'experiment',
                'scenario_id',
                'model_provider',
                'model_name',
            ],
            how='left',
        )
        .explode('states')
        .unnest('states')
    )
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
            run_id=pl.col('path').str.replace(str(RUNS_ROOT.absolute()), '').str.split('/').list.get(1),
            runs='runs',
        )
        .explode('runs')
        .unnest('runs')
    ).with_columns(
        model_name=pl.col('model_name').str.replace(':', '-'),
        solved=(pl.col('solved_strict') | pl.col('solved_semantic')).fill_null(False),
    )
    return (runs_df,)


@app.cell(hide_code=True)
def _():
    MODEL_LABEL_MAP = {
        'anthropic.claude-sonnet-4-5-20250929-v1-0': 'Claude Sonnet 4.5',
        'claude-sonnet-4-5': 'Claude Sonnet 4.5',
        'gemini-3-pro-preview': 'Gemini 3 Pro Preview',
        'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
        'gpt-5.2': 'GPT 5.2',
        'gpt-5.2-vacp': 'GPT 5.2',
        'gpt-5.4': 'GPT 5.4',
        'gpt-5.5': 'GPT 5.5',
    }
    STRATUM_LABEL_MAP = {
        'SEM': 'Semantic',
        'SYN': 'Syntactic',
        'PRG': 'Pragmatic',
    }
    EXPERIMENT_LABEL_MAP = {
        'baseline': 'S1 UI + DOM',
        'with-snapshot': 'S2 UI + DOM + State',
        'plain-mcp': 'S3 MCP (with SQL access)',
        'pure-vacp': 'S4 VACP (with SQL access)',
        'partial-toolkit': 'S5 VACP + UI + DOM (no SQL access)',
        'full-toolkit': 'S6 VACP + UI + DOM (with SQL access)',
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
    SOLVED_ORDER = [True, False]
    LABEL_MAPS = {
        'model_name': MODEL_LABEL_MAP,
        'stratum': STRATUM_LABEL_MAP,
        'experiment': EXPERIMENT_LABEL_MAP,
        'shift': SHIFT_LABEL_MAP,
        'solved': SOLVED_LABEL_MAP,
    }
    return LABEL_MAPS, SOLVED_LABEL_MAP, SOLVED_ORDER


@app.cell(hide_code=True)
def _(LABEL_MAPS, pl):

    def with_nice_labels(df: DataFrame) -> DataFrame:
        res_df = df.clone()
        for colname, label_map in LABEL_MAPS.items():
            if colname in res_df.columns:
                res_df = res_df.with_columns(pl.col(colname).cast(pl.String).replace(label_map))

        return res_df

    return (with_nice_labels,)


@app.cell(hide_code=True)
def _(os, pathlib):
    ARENA_ROOT = pathlib.Path(__file__).parents[2] / 'agent-arena'
    configured_runs_root = os.environ.get('ARENA_ANALYSIS_RUNS_ROOT')
    RUNS_ROOT = (
        pathlib.Path(configured_runs_root).expanduser().resolve()
        if configured_runs_root
        else ARENA_ROOT / '.agent-arena' / 'runs'
    )
    RUN_FILES = sorted(RUNS_ROOT.glob('*/analysis/datasets/runs_normalized.json'))
    STATES_FILES = sorted(RUNS_ROOT.glob('*/runs/**/states.json'))
    return ARENA_ROOT, RUNS_ROOT, RUN_FILES, STATES_FILES


@app.cell(hide_code=True)
def _():
    import json
    import os
    import pathlib

    import altair as alt
    import marimo as mo
    import polars as pl

    return alt, json, mo, os, pathlib, pl


if __name__ == '__main__':
    app.run()
