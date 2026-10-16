import { coordinator as globalCoordinator, DuckDBWASMConnector } from '@uwdata/mosaic-core';
import { createDuckDbWasmClient, instantiateDuckDbWasm } from '@vacp/data-duckdb';
import { exampleDuckDbBundles, mountSpecGallery } from '@vacp/example-shared';
import { marked } from 'marked';
import { loadGallery } from './gallery';
import { renderSpec } from './vacp';

export async function mount(target: HTMLElement): Promise<() => Promise<void>> {
  // One in-browser DuckDB serves both Mosaic and the VACP data actions. Mosaic inputs and tables
  // query the global coordinator, so the gallery connects that one.
  const database = await instantiateDuckDbWasm({ bundles: exampleDuckDbBundles });
  const connector = new DuckDBWASMConnector({ duckdb: database });
  const coordinator = globalCoordinator();
  coordinator.databaseConnector(connector);
  const cleanup: Array<() => unknown> = [() => database.terminate(), () => coordinator.clear()];
  const release = async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose();
  };
  try {
    const connection = await connector.getConnection();
    cleanup.push(() => connection.close());
    const duckdb = await createDuckDbWasmClient({ duckdb: database, connection });
    cleanup.push(() => duckdb.dispose());
    const unmount = await mountSpecGallery(target, {
      entries: loadGallery(),
      describe: (description) => marked.parse(description, { async: false }),
      render: (entry, context) => renderSpec(entry, { ...context, coordinator, duckdb }),
    });
    cleanup.push(unmount);
    return release;
  } catch (error) {
    await release();
    throw error;
  }
}
