export const COMPUTER_USE_PROTOCOL_VERSION = 2;

const STATE_LIMIT = 128;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function withoutPrivateFields(value) {
  if (Array.isArray(value)) {
    return value.map(withoutPrivateFields);
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith("backend_") && key !== "wire_ref" && key !== "look_id" && key !== "resource_key")
      .map(([key, entry]) => [key, withoutPrivateFields(entry)]),
  );
}

export class ResourceScheduler {
  constructor() {
    this.lanes = new Map();
  }

  epoch(resourceKey) {
    return this.#lane(resourceKey).epoch;
  }

  assertCurrent(resourceKey, expectedEpoch) {
    const actual = this.epoch(resourceKey);
    if (actual !== expectedEpoch) {
      throw new Error(`stale state: ${resourceKey} advanced from epoch ${expectedEpoch} to ${actual}; call observe_ui again`);
    }
  }

  read(resourceKey, task) {
    const lane = this.#lane(resourceKey);
    const operation = lane.tail.then(task, task);
    lane.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  mutate(resourceKey, expectedEpoch, task) {
    const lane = this.#lane(resourceKey);
    const operation = lane.tail.then(async () => {
      if (lane.epoch !== expectedEpoch) {
        throw new Error(`stale state: ${resourceKey} advanced from epoch ${expectedEpoch} to ${lane.epoch}; call observe_ui again`);
      }
      lane.epoch += 1;
      return await task(lane.epoch);
    });
    lane.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  #lane(resourceKey) {
    let lane = this.lanes.get(resourceKey);
    if (lane == null) {
      lane = { epoch: 0, tail: Promise.resolve() };
      this.lanes.set(resourceKey, lane);
    }
    return lane;
  }
}

export class RootStore {
  constructor() {
    this.nextId = 1;
    this.byRef = new Map();
    this.refByIdentity = new Map();
  }

  registerMany(roots, sessionId) {
    return roots.map((root) => this.register(root, sessionId));
  }

  register(root, sessionId) {
    if (typeof root?.resource_key !== "string" || root.resource_key.length === 0) {
      throw new Error("backend root is missing resource_key");
    }
    if (typeof root.backend_ref !== "string" || root.backend_ref.length === 0) {
      throw new Error("backend root is missing backend_ref");
    }
    const identity = `${sessionId ?? "foreground"}:${root.kind}:${root.backend_ref}`;
    let rootRef = this.refByIdentity.get(identity);
    if (rootRef == null) {
      rootRef = `@r${this.nextId++}`;
      this.refByIdentity.set(identity, rootRef);
    }
    const record = { rootRef, sessionId: sessionId ?? null, backend: clone(root) };
    this.byRef.set(rootRef, record);
    return {
      rootRef,
      resourceKey: root.resource_key,
      ...withoutPrivateFields(root),
    };
  }

  require(rootRef, sessionId) {
    const record = this.byRef.get(rootRef);
    if (record == null) {
      throw new Error(`unknown root ref ${rootRef}; call find_roots again`);
    }
    if (sessionId != null && record.sessionId !== sessionId) {
      throw new Error(`root ${rootRef} belongs to session ${record.sessionId ?? "foreground"}`);
    }
    return record;
  }

  deleteSession(sessionId) {
    for (const [rootRef, record] of this.byRef) {
      if (record.sessionId === sessionId) {
        this.byRef.delete(rootRef);
      }
    }
    for (const [identity] of this.refByIdentity) {
      if (identity.startsWith(`${sessionId}:`)) {
        this.refByIdentity.delete(identity);
      }
    }
  }
}

export class StateStore {
  constructor(limit = STATE_LIMIT) {
    this.limit = limit;
    this.nextId = 1;
    this.byId = new Map();
  }

  save(rootRecord, epoch, backendObservation) {
    if (backendObservation?.protocol_version !== COMPUTER_USE_PROTOCOL_VERSION) {
      throw new Error(`backend protocol mismatch: expected ${COMPUTER_USE_PROTOCOL_VERSION}, received ${backendObservation?.protocol_version ?? "missing"}`);
    }
    if (typeof backendObservation.look_id !== "string" || backendObservation.look_id.length === 0) {
      throw new Error("backend observation is missing look_id");
    }
    if (backendObservation.backend_root == null || typeof backendObservation.backend_root !== "object") {
      throw new Error("backend observation is missing backend_root");
    }
    const nodes = backendObservation.outline?.nodes;
    if (!Array.isArray(nodes)) {
      throw new Error("backend observation is missing the accessibility outline");
    }
    const stateId = `state-${this.nextId++}`;
    const wireByRef = new Map();
    const publicNodes = nodes.map((node, index) => {
      if (typeof node.wire_ref !== "string" || node.wire_ref.length === 0) {
        throw new Error(`backend outline node ${index} is missing wire_ref`);
      }
      const ref = `@e${index + 1}`;
      wireByRef.set(ref, node.wire_ref);
      return { ref, ...withoutPrivateFields(node) };
    });
    const publicObservation = {
      stateId,
      rootRef: rootRecord.rootRef,
      resourceKey: rootRecord.backend.resource_key,
      epoch,
      coordinateSpace: backendObservation.coordinate_space,
      capturedAt: backendObservation.captured_at,
      root: withoutPrivateFields(backendObservation.root),
      window: withoutPrivateFields(backendObservation.window),
      outline: {
        nodes: publicNodes,
        truncated: Boolean(backendObservation.outline.truncated),
      },
    };
    if (backendObservation.image != null) {
      publicObservation.image = clone(backendObservation.image);
    }
    const record = {
      stateId,
      rootRef: rootRecord.rootRef,
      resourceKey: rootRecord.backend.resource_key,
      sessionId: rootRecord.sessionId,
      epoch,
      lookId: backendObservation.look_id,
      backendRoot: clone(backendObservation.backend_root),
      wireByRef,
      observation: publicObservation,
    };
    this.byId.set(stateId, record);
    while (this.byId.size > this.limit) {
      this.byId.delete(this.byId.keys().next().value);
    }
    return record;
  }

  require(stateId) {
    const record = this.byId.get(stateId);
    if (record == null) {
      throw new Error(`unknown or expired state ${stateId}; call observe_ui again`);
    }
    return record;
  }

  wireRef(record, ref, optional = false) {
    if (ref == null && optional) {
      return null;
    }
    const wireRef = record.wireByRef.get(ref);
    if (wireRef == null) {
      throw new Error(`element ref ${ref} does not belong to ${record.stateId}`);
    }
    return wireRef;
  }

  deleteSession(sessionId) {
    for (const [stateId, record] of this.byId) {
      if (record.sessionId === sessionId) {
        this.byId.delete(stateId);
      }
    }
  }
}

export function searchState(record, args) {
  const query = String(args.query ?? "").trim().toLocaleLowerCase();
  if (!query) {
    throw new Error("search_ui requires a non-empty query");
  }
  const roles = new Set((args.roles ?? []).map((role) => String(role).toLocaleLowerCase()));
  const limit = args.limit ?? 25;
  const nodes = record.observation.outline.nodes.filter((node) => {
    if (roles.size > 0 && !roles.has(String(node.role ?? "").toLocaleLowerCase())) {
      return false;
    }
    return [node.name, node.description, node.text, node.value, node.role]
      .filter((value) => value != null)
      .some((value) => String(value).toLocaleLowerCase().includes(query));
  }).slice(0, limit);
  return { stateId: record.stateId, matches: clone(nodes), count: nodes.length };
}

export function inspectState(record, ref) {
  const node = record.observation.outline.nodes.find((entry) => entry.ref === ref);
  if (node == null) {
    throw new Error(`element ref ${ref} does not belong to ${record.stateId}`);
  }
  return { stateId: record.stateId, node: clone(node) };
}

export function expandState(record, ref, depth = 1) {
  const nodes = record.observation.outline.nodes;
  const index = nodes.findIndex((entry) => entry.ref === ref);
  if (index < 0) {
    throw new Error(`element ref ${ref} does not belong to ${record.stateId}`);
  }
  const rootDepth = Number(nodes[index].depth ?? 0);
  const expanded = [nodes[index]];
  for (let cursor = index + 1; cursor < nodes.length; cursor += 1) {
    const nodeDepth = Number(nodes[cursor].depth ?? 0);
    if (nodeDepth <= rootDepth) {
      break;
    }
    if (nodeDepth <= rootDepth + depth) {
      expanded.push(nodes[cursor]);
    }
  }
  return { stateId: record.stateId, nodes: clone(expanded), count: expanded.length };
}

export function observationDiff(before, after) {
  const signature = (node) => JSON.stringify([
    node.role,
    node.name,
    node.description,
    node.text,
    node.value,
    node.states,
    node.bounds,
  ]);
  const beforeCounts = new Map();
  for (const node of before.observation.outline.nodes) {
    const key = signature(node);
    beforeCounts.set(key, (beforeCounts.get(key) ?? 0) + 1);
  }
  const afterCounts = new Map();
  for (const node of after.observation.outline.nodes) {
    const key = signature(node);
    afterCounts.set(key, (afterCounts.get(key) ?? 0) + 1);
  }
  let added = 0;
  let removed = 0;
  for (const [key, count] of afterCounts) {
    added += Math.max(0, count - (beforeCounts.get(key) ?? 0));
  }
  for (const [key, count] of beforeCounts) {
    removed += Math.max(0, count - (afterCounts.get(key) ?? 0));
  }
  return {
    fromStateId: before.stateId,
    toStateId: after.stateId,
    added,
    removed,
    changed: added > 0 || removed > 0 || JSON.stringify(before.observation.window) !== JSON.stringify(after.observation.window),
  };
}
