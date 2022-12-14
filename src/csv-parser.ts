/**
 * File: csv-parser.ts
 * Purpose: Implements CsvParser class.
 * 
 * References:
 * - https://www.rfc-editor.org/rfc/rfc4180
 * - https://www.unicode.org/reports/tr6/tr6-4.html
 */

const debug = false;

// TODO: Remove debug options.
import { ansiEscape } from "./ansiEscape"; // For debug.

/* The transition triple is [symbol,state,action] */
export type TransitionProduction = [number, number, number];

/**
 * The transition table is a table[state][triple] where last triple of
 * table[state] array is the default transition (symbol = 0).
 */
export type TransitionTable = TransitionProduction[][];

/* The set of final accepting states. */
export type FinalStates = number[];

/**
 * Callbacks for error and parsed field and record.
 */
export type ErrorCallback = (err: any) => void;
export type FieldCallback = (field: string, index?: number, line?: number) => void;
export type RecordCallBack = (record: string[], line?: number) => (void | string | Buffer);

/* Symbols for white space, line break and page break. */
const HT = 0x09  /* horizontal tab */
const LF = 0x0a; /* Line feed */
const FF = 0x0c  /* Form feed (page break) */
const CR = 0x0d; /* Carriage Return */
const HS = 0x20; /* Horizotal Space */

/* CsvParser instance configuration. */
export interface CsvParserConfiguration {
    delimiter: string,
    quote: string,
    quoteRequired: boolean,
    encoding: BufferEncoding,
    onError: ErrorCallback,
    onHeaderField: FieldCallback,
    onField: FieldCallback,
    onHeader: RecordCallBack,
    onRecord: RecordCallBack,
}
export type CsvParserOptions = Partial<CsvParserConfiguration>

/* Parser automata error interface. */
export interface CsvParserErrorInfo {
    input: string,
    line: number,
    pos: number,
    state: number
}

/**
 * CsvParser class
 */
export class CsvParser {
    // TODO: Remove debug options.
    public debug: boolean = debug;
    private _initial!: boolean; // Only true if parse or accept method never called.
    private _bom!: boolean; // If true, detect and exclude the byte order mark (BOM) from the CSV input if present.
    private _delimiter!: number;
    private _quote!: number; // Optional character surrounding a field as one character only; disabled if null, false or empty; defaults to double quote.
    private _quote_required!: boolean;
    private _encoding!: BufferEncoding;
    private _state!: number;
    private _saved_state!: number;
    private _lineno!: number;
    private _pos!: number;
    private _saved_pos!: number;
    private _saved_index!: number;
    private _field!: string;
    private _header!: string[];
    private _record!: string[];
    private _parsed!: string;
    private _transition!: TransitionTable;
    private _final!: FinalStates;

    private _on_field_callback!: FieldCallback | undefined | null;
    private _on_record_callback!: RecordCallBack;
    private _on_error!: ErrorCallback;
    private _on_header_field!: FieldCallback | undefined | null;
    private _on_field!: FieldCallback | undefined | null;
    private _on_header!: RecordCallBack | undefined | null;
    private _on_record!: RecordCallBack;

    /**
     * The constructor is not public because the class provides a static
     * method for instantiation: CsvParser.create()
     * @param options 
     */
    protected constructor(options?: CsvParserOptions) {
        this.reset(options);
    }

    public unparseRecord(record: string[]): string {
        return `${this.quote}${record.map(field => field.replace(this.quote, this.quote + this.quote)).join(this.quote + this.delimiter + this.quote)}${this.quote}`
    }

    private defaultDelimiter = ','.charCodeAt(0);
    private defaultQuote = '"'.charCodeAt(0);

    private defaultOnError: ErrorCallback = (err: CsvParserErrorInfo) => {
        console.log(`[${err.line?.toString().padStart(4, ' ')}]: `, {
            input: err.input,
            pos: err.pos,
            state: err.state
        });
    }

    private defaultOnRecord: RecordCallBack = (record: string[], line?: number): string => {
        //TODO: remove substring (only for debug)
        let result = `[${(this._on_header?(line!-1):line)?.toString().padStart(6, ' ')}] : ${this.unparseRecord(record)}`.substring(0, 60) + '...';
        console.log(result);
        return result;
    };

    /**
     * Reset CsvParser instance to start to process first chunk
     * @param options 
     */
    public reset(options?: CsvParserOptions): void {
        this._initial = true;
        this._state = 0;
        this._lineno = 1;
        this._pos = 0;
        this._saved_pos = NaN;
        this._saved_state = NaN;
        this._saved_index = NaN;
        this._field = '';
        this._record = [];
        this._parsed = '';
        if (!options) {
            this._delimiter = this.defaultDelimiter;
            this._quote = this.defaultQuote;
            this._quote_required = false;
            this._encoding = 'utf-8'
            this._on_error = this.defaultOnError;
            this._on_header_field = null;
            this._on_field = null;
            this._on_field_callback = null;
            this._on_header = null;
            this._on_record = this.defaultOnRecord;
        }
        else {
            if (options.delimiter) {
                if (options.delimiter.length != 1) throw new Error('Delimiter must be a string of one character (default is \',\')');
                this._delimiter = options.delimiter.charCodeAt(0);
            }
            else {
                this._delimiter = this.defaultDelimiter;
            }
            if (options.quote) {
                if (options.quote.length > 1) throw new Error('Quote delimiter must be null or a string of one character (default is \'"\')');
                if (options.quote.length) {
                    this._quote = options.quote.charCodeAt(0);
                    this._quote_required = options.quoteRequired ? options.quoteRequired : false;
                }
                else {
                    this._quote = 0;
                    this._quote_required = false;
                }

            }
            else {
                this._quote = 0;
                this._quote_required = false;
            }
            this._encoding = options.encoding ? options.encoding : 'utf-8'
            this._on_error = options.onError ? options.onError : this.defaultOnError;
            this._on_header_field = options.onHeaderField ? options.onHeaderField : null;
            this._on_field = options.onField ? options.onField : null;
            this._on_header = options.onHeader ? options.onHeader : null;
            this._on_record = options.onRecord ? options.onRecord : this.defaultOnRecord;
        }
        if (this._on_header) {
            this._on_record_callback = (record: string[], line?: number): string => {
                this._on_record_callback = this._on_record;
                this._on_field_callback = this._on_field;
                this._header = this._record;
                this._parsed += this._on_header!(this._header);
                return '';
            };
        }
        else {
            this._on_record_callback = this._on_record;
        }
        if (this._on_header_field) {
            if (!this._on_header) {
                this._on_record_callback = (record: string[], line?: number): string => {
                    this._on_field_callback = this._on_field;
                    return '';
                }
            }
            this._on_field_callback = this._on_header_field;
        }
        this._transition = [
            /*  0 */[
                [this._quote, 3, 1],
                [this._delimiter, 0, 3],
                [CR, 1, 4],
                [LF, 0, 4],
                [0, 2, 0]
            ],
            /*  1 */[
                [LF, 0, 1],
                [CR, 1, 4],
                [0, 0, 2]
            ],
            /*  2 */[
                [this._delimiter, 0, 3],
                [this._quote, 9, 7],
                [CR, 1, 4],
                [LF, 0, 4],
                [0, 2, 0]
            ],
            /*  3 */[
                [this._quote, 5, 1],
                [0, 4, 0]
            ],
            /*  4 */[
                [this._quote, 5, 1],
                [0, 4, 0]
            ],
            /*  5 */[
                [this._delimiter, 0, 3],
                [this._quote, 6, 0],
                [CR, 1, 4],
                [LF, 0, 4],
                [0, 8, 7]
            ],
            /*  6 */[
                [this._quote, 5, 1],
                [0, 4, 0]
            ],
            /*  7 */[
                [LF, 0, 6],
                [0, 0, 5]
            ],
            /*  8 */[
                [CR, 7, 1],
                [LF, 0, 6],
                [0, 8, 1]
            ],
            /*  9 */[
                [CR, 7, 1],
                [LF, 0, 6],
                [0, 9, 1]
            ],
        ];
        this._final = [0, 1, 2, 5];
        if (!this._quote) {
            this._transition[0].splice(0, 1);
            this._transition[2].splice(1, 1);
            this._final.splice(3, 1);
        }
        else {
            if (this._quote_required) {
                this._transition[0][4] = [0, 9, 7];
            }
        }
    }

    /* Static method for instantiation */
    public static create(options?: CsvParserOptions): CsvParser {
        return new CsvParser(options);
    }

    /**
     * Properties getters
     */
    public get delimiter(): string {
        return String.fromCharCode(this._delimiter);
    }

    public get quote(): string {
        return (this._quote) ? String.fromCharCode(this._quote) : '';
    }

    public get quote_required(): boolean {
        return this._quote_required;
    }

    public get lineno(): number {
        return this._lineno;
    }

    public get pos(): number {
        return this._pos;
    }

    public get saved_pos(): number {
        return this._saved_pos;
    }

    public get saved_index(): number {
        return this._saved_index;
    }

    public get field(): string {
        return this._field;
    }

    public get record(): string[] {
        return this._record;
    }

    public get state(): number {
        return this._state;
    }

    public get saved_state(): number {
        return this._saved_state;
    }

    /**
     * Returns true if current state is a final state.
     */
    public get final(): boolean {
        return (this._final.indexOf(this._state) > -1)
    }

    public get parsed(): Buffer {
        return this._parsed as unknown as Buffer;
    }

    public static parse(chunk: Buffer | string, options?: CsvParserOptions): CsvParser {
        const result = new CsvParser(options);
        result.parse(chunk);
        return result;
    }

    public parse(chunk: Buffer | string): (void | string | Buffer) {
        this._initial = false;
        if (typeof chunk === 'string') chunk = Buffer.from(chunk, this._encoding)
        this._parsed = '';
        let n = 0;
        const doAction = (action: number, s: number): number => {
            switch (action) {
                case 0: // append character at chunk[n] to field
                    this._field += String.fromCharCode(chunk[n] as number);
                case 1: // null action, only do state transition
                    return s;
                case 2: // Unshift one character to chunk
                    n--;
                    return s;
                case 3: // add field
                case 4: // add last field
                    if (this._on_field_callback) this._on_field_callback(this._field, this._record.length, this._lineno);
                    this._record.push(this._field);
                    this._field = '';
                    if (action == 3) return s;
                    this._parsed += this._on_record_callback(this._record, this._lineno);
                    this._record = [];
                    this._lineno++;
                    this._pos = 0;
                    return s;
                case 5: // Emit error then unshift one character to chunk.
                case 6: // Emit error.
                    this._on_error({
                        input: chunk.slice(n - this._pos + ((chunk[n - this._pos] == CR || chunk[n - this._pos] == LF) ? 1 : 0), n - 1).toString(),
                        line: this._lineno,
                        pos: this._saved_pos,
                        state: this._saved_state,
                    })
                    this._lineno++;
                    this._pos = 0;
                    this._saved_pos = NaN;
                    this._saved_state = NaN;
                    this._saved_index = NaN;
                    this._record = [];
                    this._field = '';
                    if (action == 6) return (chunk[n] == CR) ? 7 : 0; // Go to state 1 or 0.
                    n--;
                    return 0;
                case 7: // Store error position and state.
                    this._saved_state = s;
                    this._saved_pos = this._pos;
                    this._saved_index = n;
                    return s;
                default: // Unexpected action.
                    return NaN;
            }
        }
        for (; n < chunk.length; n++) {
            if (chunk[n] != LF) this._pos++;
            let st = 0;
            for (; st < this._transition[this._state].length - 1; st++)
                if (chunk[n] == this._transition[this._state][st][0]) break;
            // TODO: Remove debug options.
            if (this.debug) console.log(`s${this._state} :${ansiEscape(String.fromCharCode(chunk[n])).padStart(2, ' ')} > s${this._transition[this._state][st][1]} (${this._transition[this._state][st][2]}) ${this._lineno.toString().padStart(9, ' ')}:${this._pos}`)
            this._state = doAction(this._transition[this._state][st][2], this._transition[this._state][st][1]);
        }
        // TODO: Remove debug options.
        if (this.debug) console.log(`s${this._state} ${this._lineno.toString().padStart(9, ' ')}:`)
        return this._parsed;
    }

    public accept(): boolean {
        this._initial = false;
        if (this._final.indexOf(this._state) > -1) {
            if (this._on_field_callback) this._on_field_callback(this._field, this._record.length, this._lineno);
            this._record.push(this._field);
            this._field = '';
            this._parsed = this._on_record_callback(this._record, this._lineno) as string;
            this._record = [];
            this._lineno++;
            this._pos = 0;
            this._saved_pos = NaN;
            this._saved_state = NaN;
            this._saved_index = NaN;
            return true;
        }
        else {
            this._parsed = '';
            return false;
        }
    }

}
