/**
 * Okapi BM25 over an in-memory inverted index.
 *
 * Besides the score, every search reports each document's *query coverage*: the share of the
 * query's IDF mass that the document contains. Coverage is bounded to [0, 1], which BM25 scores
 * are not, so it is what the relevance gate uses. It still depends on the query and the corpus:
 * each extra query term adds to the mass a document has to cover, so a longer query covers less
 * of itself on the same document, and a term no document contains gets the highest IDF, so it
 * weighs heavily against every document.
 */

export interface Bm25Options {
  /** Term-frequency saturation. Default 1.2. */
  k1?: number;
  /** Length normalization. Default 0.75. */
  b?: number;
}

export interface Bm25Result {
  /** BM25 score per document; 0 where no query term matched. */
  scores: Float32Array;
  /** Query coverage per document, in [0, 1]. */
  coverage: Float32Array;
  /** Indices of documents with a non-zero score, best first. */
  ranked: number[];
}

export class Bm25Index {
  readonly size: number;
  private readonly termIds = new Map<string, number>();
  /** Postings in compressed sparse row form: term `t` owns `[termStart[t], termStart[t + 1])`. */
  private readonly termStart: Uint32Array;
  private readonly postingDocs: Uint32Array;
  private readonly postingFreqs: Uint16Array;
  private readonly lengths: Uint32Array;
  private readonly averageLength: number;
  private readonly k1: number;
  private readonly b: number;

  constructor(documents: readonly (readonly string[])[], options: Bm25Options = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
    this.size = documents.length;
    this.lengths = new Uint32Array(documents.length);

    // Pass 1: intern terms, count per document, and record (term, count) pairs.
    // Dense per-term scratch arrays (indexed by term id) instead of a Map per document.
    const documentFrequency: number[] = [];
    const lastSeen: number[] = [];
    const termFrequency: number[] = [];
    const unique: number[] = [];
    const pairs: number[] = [];
    const pairStart = new Uint32Array(documents.length + 1);
    let total = 0;
    documents.forEach((terms, doc) => {
      this.lengths[doc] = terms.length;
      total += terms.length;
      unique.length = 0;
      for (const term of terms) {
        let id = this.termIds.get(term);
        if (id === undefined) {
          id = documentFrequency.length;
          this.termIds.set(term, id);
          documentFrequency.push(0);
          lastSeen.push(-1);
          termFrequency.push(0);
        }
        if (lastSeen[id] !== doc) {
          lastSeen[id] = doc;
          termFrequency[id] = 0;
          unique.push(id);
        }
        termFrequency[id] = (termFrequency[id] ?? 0) + 1;
      }
      for (const id of unique) {
        pairs.push(id, termFrequency[id] ?? 0);
        documentFrequency[id] = (documentFrequency[id] ?? 0) + 1;
      }
      pairStart[doc + 1] = pairs.length;
    });

    // Pass 2: lay postings out contiguously, grouped by term.
    this.termStart = new Uint32Array(documentFrequency.length + 1);
    documentFrequency.forEach((df, id) => {
      this.termStart[id + 1] = (this.termStart[id] ?? 0) + df;
    });
    const postings = pairs.length / 2;
    this.postingDocs = new Uint32Array(postings);
    this.postingFreqs = new Uint16Array(postings);
    const cursor = this.termStart.slice(0, -1);
    for (let doc = 0; doc < documents.length; doc += 1) {
      for (let i = pairStart[doc] ?? 0; i < (pairStart[doc + 1] ?? 0); i += 2) {
        const id = pairs[i] ?? 0;
        const slot = cursor[id] ?? 0;
        cursor[id] = slot + 1;
        this.postingDocs[slot] = doc;
        this.postingFreqs[slot] = Math.min(pairs[i + 1] ?? 0, 0xffff);
      }
    }
    this.averageLength = documents.length > 0 ? total / documents.length : 0;
  }

  private documentFrequency(id: number | undefined): number {
    return id === undefined ? 0 : (this.termStart[id + 1] ?? 0) - (this.termStart[id] ?? 0);
  }

  /** Inverse document frequency (the BM25+ variant, always positive). */
  idf(term: string): number {
    const df = this.documentFrequency(this.termIds.get(term));
    return Math.log(1 + (this.size - df + 0.5) / (df + 0.5));
  }

  search(queryTerms: readonly string[]): Bm25Result {
    const scores = new Float32Array(this.size);
    const matched = new Float32Array(this.size);
    let totalIdf = 0;

    for (const term of new Set(queryTerms)) {
      const id = this.termIds.get(term);
      const df = this.documentFrequency(id);
      const idf = Math.log(1 + (this.size - df + 0.5) / (df + 0.5));
      totalIdf += idf;
      if (id === undefined) continue;
      const end = this.termStart[id + 1] ?? 0;
      for (let i = this.termStart[id] ?? 0; i < end; i += 1) {
        const doc = this.postingDocs[i] ?? 0;
        const tf = this.postingFreqs[i] ?? 0;
        const norm = 1 - this.b + (this.b * (this.lengths[doc] ?? 0)) / (this.averageLength || 1);
        scores[doc] = (scores[doc] ?? 0) + (idf * (tf * (this.k1 + 1))) / (tf + this.k1 * norm);
        matched[doc] = (matched[doc] ?? 0) + idf;
      }
    }

    const ranked: number[] = [];
    for (let doc = 0; doc < this.size; doc += 1) if ((scores[doc] ?? 0) > 0) ranked.push(doc);
    ranked.sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a - b);

    const coverage = matched;
    if (totalIdf > 0) {
      for (const doc of ranked) coverage[doc] = (matched[doc] ?? 0) / totalIdf;
    }
    return { scores, coverage, ranked };
  }
}
