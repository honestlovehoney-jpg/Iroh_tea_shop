// A small in-memory stand-in for the Prisma calls the saved-theses routes make.
type Row = Record<string, any>;

export function createFakeDb() {
  let seq = 0;
  const theses: Row[] = [];
  const paths: Row[] = [];
  const claims: Row[] = [];
  const seals: Row[] = [];
  const locks: Row[] = [];
  const portfolios: Row[] = [];
  const assets: Row[] = [];
  const observations: Row[] = [];
  const nextId = (prefix: string) => `${prefix}${++seq}`;

  const matches = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([key, want]) => {
      if (want && typeof want === 'object' && 'in' in want)
        return (want.in as unknown[]).includes(row[key]);
      return row[key] === want;
    });

  const withPaths = (thesis: Row, include?: Row) => {
    const out: Row = { ...thesis };
    if (include?.failurePaths) {
      const opts = include.failurePaths === true ? {} : include.failurePaths;
      out.failurePaths = paths
        .filter((p) => p.thesisId === thesis.id && matches(p, opts.where))
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((p) => ({ ...p }));
    }
    if (include?.claims)
      out.claims = claims.filter((c) => c.thesisId === thesis.id).map((c) => ({ ...c }));
    if (include?.lock) {
      const found = locks.find((x) => x.thesisId === thesis.id);
      out.lock = found ? { ...found } : null;
    }
    if (include?.seal) {
      const found = seals.find((x) => x.thesisId === thesis.id);
      out.seal = found ? { ...found } : null;
    }
    return out;
  };

  return {
    __reset() {
      theses.length = paths.length = claims.length = seals.length = locks.length = portfolios.length = assets.length = observations.length = 0;
      seq = 0;
    },
    __addAsset(row: Row) {
      assets.push(row);
    },
    __addObservation(row: Row) {
      const at = observations.findIndex((o) => o.cacheKey === row.cacheKey);
      if (at >= 0) observations.splice(at, 1);
      observations.push(row);
    },
    session: { findUnique: async () => null },
    bitgetAsset: {
      findFirst: async ({ where }: Row) =>
        assets.find((a) => matches(a, where)) ?? null,
      findUnique: async ({ where }: Row) =>
        assets.find((a) => matches(a, where)) ?? null,
    },
    bitgetSignalObservation: {
      findUnique: async ({ where }: Row) =>
        observations.find((o) => o.cacheKey === where.cacheKey) ?? null,
      upsert: async () => ({}),
    },
    bitgetSignalCoverage: {
      findUnique: async () => null,
      upsert: async () => ({}),
    },
    thesis: {
      findFirst: async ({ where, include }: Row) => {
        const found = theses.find((t) => matches(t, where));
        return found ? withPaths(found, include) : null;
      },
      findMany: async ({ where, include }: Row) =>
        theses
          .filter((t) => matches(t, where))
          .sort((a, b) => b.createdAt - a.createdAt || (b.id > a.id ? 1 : -1))
          .map((t) => withPaths(t, include)),
      count: async ({ where }: Row) => theses.filter((t) => matches(t, where)).length,
      create: async ({ data, include }: Row) => {
        const row = {
          id: nextId('t'),
          content: null,
          instrumentId: null,
          symbol: null,
          status: 'draft',
          createdAt: new Date(Date.now() + seq),
          updatedAt: new Date(),
          ...data,
        };
        theses.push(row);
        return withPaths(row, include ?? {});
      },
      updateMany: async ({ where, data }: Row) => {
        const hits = theses.filter((t) => matches(t, where));
        hits.forEach((t) => Object.assign(t, data, { updatedAt: new Date() }));
        return { count: hits.length };
      },
      delete: async ({ where }: Row) => {
        const index = theses.findIndex((t) => t.id === where.id);
        if (index >= 0) theses.splice(index, 1);
        for (let i = paths.length - 1; i >= 0; i--)
          if (paths[i].thesisId === where.id) paths.splice(i, 1);
        for (let i = claims.length - 1; i >= 0; i--)
          if (claims[i].thesisId === where.id) claims.splice(i, 1);
        for (let i = seals.length - 1; i >= 0; i--)
          if (seals[i].thesisId === where.id) seals.splice(i, 1);
        for (let i = locks.length - 1; i >= 0; i--)
          if (locks[i].thesisId === where.id) locks.splice(i, 1);
        return {};
      },
    },
    failurePath: {
      create: async ({ data }: Row) => {
        const row = {
          id: nextId('p'),
          source: 'uncle',
          decision: 'pending',
          decisionReason: null,
          originalJson: null,
          resolvedAt: null,
          triggerLevel: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        paths.push(row);
        return { ...row };
      },
      update: async ({ where, data }: Row) => {
        const row = paths.find((p) => p.id === where.id)!;
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
      delete: async ({ where }: Row) => {
        const index = paths.findIndex((p) => p.id === where.id);
        if (index >= 0) paths.splice(index, 1);
        return {};
      },
      deleteMany: async ({ where }: Row) => {
        let count = 0;
        for (let i = paths.length - 1; i >= 0; i--)
          if (matches(paths[i], where)) {
            paths.splice(i, 1);
            count++;
          }
        return { count };
      },
    },
    portfolio: {
      findUnique: async ({ where }: Row) =>
        portfolios.find((p) => p.ownerKey === where.ownerKey) ?? null,
      upsert: async ({ where, create, update }: Row) => {
        const found = portfolios.find((p) => p.ownerKey === where.ownerKey);
        if (found) return Object.assign(found, update);
        const row = { id: nextId('f'), ...create };
        portfolios.push(row);
        return row;
      },
    },
    lock: {
      create: async ({ data }: Row) => {
        if (locks.some((x) => x.thesisId === data.thesisId)) throw new Error('unique');
        const row = { id: nextId('l'), overrideReason: null, ...data };
        locks.push(row);
        return { ...row };
      },
    },
    seal: {
      create: async ({ data }: Row) => {
        if (seals.some((x) => x.thesisId === data.thesisId)) throw new Error('unique');
        const row = {
          id: nextId('s'),
          status: 'open',
          outcome: null,
          resolvedPrice: null,
          resolvedAt: null,
          userBrier: null,
          systemBrier: null,
          baseRate: null,
          systemRationale: null,
          ...data,
        };
        seals.push(row);
        return { ...row };
      },
      update: async ({ where, data }: Row) => {
        const row = seals.find((x) => x.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
    },
    claim: {
      create: async ({ data }: Row) => {
        const row = {
          id: nextId('c'),
          origin: 'system',
          valueText: null,
          sourceUrl: null,
          observedAt: null,
          marketClosed: false,
          note: null,
          acknowledged: false,
          createdAt: new Date(Date.now() + seq),
          ...data,
        };
        claims.push(row);
        return { ...row };
      },
      update: async ({ where, data }: Row) => {
        const row = claims.find((c) => c.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
      delete: async ({ where }: Row) => {
        const index = claims.findIndex((c) => c.id === where.id);
        if (index >= 0) claims.splice(index, 1);
        return {};
      },
      deleteMany: async ({ where }: Row) => {
        let count = 0;
        for (let i = claims.length - 1; i >= 0; i--)
          if (matches(claims[i], where)) {
            claims.splice(i, 1);
            count++;
          }
        return { count };
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
}

export type FakeDb = ReturnType<typeof createFakeDb>;
