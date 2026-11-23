export type SalesVideoDraftFields = Record<string, string | number | boolean>;

type DraftEntry = { key: string; fields?: SalesVideoDraftFields; file?: File };
type LoadedDraft = { fields: SalesVideoDraftFields; files: Record<string, File> };

const DATABASE = "storyai-sales-video-drafts";
const STORE = "entries";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = window.indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open sales video drafts"));
    request.onblocked = () => reject(new Error("Sales video draft database is blocked"));
  });
}

function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Sales video draft request failed"));
  });
}

function fieldsKey(owner: string, templateId: string) { return `fields:${owner}:${templateId}`; }
function fileKey(owner: string, templateId: string, name: string) { return `file:${owner}:${templateId}:${name}`; }
function fallbackKey(owner: string, templateId: string) { return `storyai:sales-video-draft:${owner}:${templateId}`; }

export async function loadSalesVideoDraft(owner: string, templateId: string, fileNames: string[]): Promise<LoadedDraft> {
  const empty = { fields: {} as SalesVideoDraftFields, files: {} as Record<string, File> };
  if (!owner) return empty;
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE, "readonly");
    const store = transaction.objectStore(STORE);
    const fieldRequest = store.get(fieldsKey(owner, templateId)) as IDBRequest<DraftEntry | undefined>;
    const fileRequests = fileNames.map((name) => store.get(fileKey(owner, templateId, name)) as IDBRequest<DraftEntry | undefined>);
    const [fieldEntry, ...fileEntries] = await Promise.all([requestValue(fieldRequest), ...fileRequests.map(requestValue)]);
    database.close();
    const files: Record<string, File> = {};
    fileEntries.forEach((entry, index) => { if (entry?.file) files[fileNames[index]] = entry.file; });
    return { fields: fieldEntry?.fields || {}, files };
  } catch {
    try {
      const fields = JSON.parse(window.localStorage.getItem(fallbackKey(owner, templateId)) || "{}") as SalesVideoDraftFields;
      return { ...empty, fields };
    } catch {
      return empty;
    }
  }
}

export async function saveSalesVideoDraftFields(owner: string, templateId: string, fields: SalesVideoDraftFields) {
  if (!owner) return;
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put({ key: fieldsKey(owner, templateId), fields } satisfies DraftEntry);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not save sales video draft"));
      transaction.onabort = () => reject(transaction.error || new Error("Sales video draft save was aborted"));
    });
    database.close();
  } catch {
    try { window.localStorage.setItem(fallbackKey(owner, templateId), JSON.stringify(fields)); } catch { /* Storage may be disabled or full. */ }
  }
}

export async function saveSalesVideoDraftFile(owner: string, templateId: string, name: string, file?: File) {
  if (!owner) return true;
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const key = fileKey(owner, templateId, name);
    if (file) store.put({ key, file } satisfies DraftEntry);
    else store.delete(key);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not save sales video file"));
      transaction.onabort = () => reject(transaction.error || new Error("Sales video file save was aborted"));
    });
    database.close();
    return true;
  } catch {
    return false;
  }
}

export async function clearSalesVideoDraft(owner: string, templateId: string, fileNames: string[]) {
  if (!owner) return;
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    store.delete(fieldsKey(owner, templateId));
    fileNames.forEach((name) => store.delete(fileKey(owner, templateId, name)));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not clear sales video draft"));
      transaction.onabort = () => reject(transaction.error || new Error("Sales video draft clear was aborted"));
    });
    database.close();
  } catch {
    try { window.localStorage.removeItem(fallbackKey(owner, templateId)); } catch { /* Storage may be disabled. */ }
  }
}
