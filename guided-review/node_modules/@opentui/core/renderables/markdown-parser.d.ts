import { type MarkedToken } from "marked";
export interface ParseState {
    content: string;
    tokens: MarkedToken[];
    stableTokenCount?: number;
}
/**
 * Incrementally parse markdown, reusing unchanged tokens from previous parse.
 * Compares token.raw at each offset - matching tokens keep same object reference.
 * trailingUnstable 0 lexes it all unless nothing changed since a lex at 0: an edit can grow any block or add a link def.
 */
export declare function parseMarkdownIncremental(newContent: string, prevState: ParseState | null, trailingUnstable?: number): ParseState;
