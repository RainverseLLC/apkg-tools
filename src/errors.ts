export class ApkgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApkgError';
  }
}

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}
