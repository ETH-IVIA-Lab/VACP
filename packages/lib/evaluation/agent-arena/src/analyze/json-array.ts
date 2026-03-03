import fs from 'node:fs';
import path from 'node:path';

export class JsonArrayWriter {
  readonly #stream: fs.WriteStream;
  #opened = false;
  #hasRows = false;

  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.#stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
  }

  writeRow(row: unknown) {
    if (!this.#opened) {
      this.#stream.write('[');
      this.#opened = true;
    }
    if (this.#hasRows) {
      this.#stream.write(',\n');
    } else {
      this.#stream.write('\n');
      this.#hasRows = true;
    }
    this.#stream.write(JSON.stringify(row));
  }

  async close(): Promise<void> {
    if (!this.#opened) {
      this.#stream.write('[]\n');
    } else {
      this.#stream.write('\n]\n');
    }
    await new Promise<void>((resolve, reject) => {
      this.#stream.end(() => resolve());
      this.#stream.once('error', reject);
    });
  }
}
