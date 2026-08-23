const viewImporters = {
  create: () => import('../views/SetEditorView'),
  edit: () => import('../views/SetEditorView'),
  flashcards: () => import('../views/FlashcardView'),
  learn: () => import('../views/LearnView'),
  typing: () => import('../views/TypingView'),
  progress: () => import('../views/ProgressView')
};

const moduleCache = new Map();

export const loadViewModule = (view) => {
  const importer = viewImporters[view];
  if (!importer) return Promise.reject(new Error(`Không tìm thấy màn hình ${view}.`));
  if (!moduleCache.has(view)) moduleCache.set(view, importer());
  return moduleCache.get(view);
};

export const preloadInteractiveViews = () => Promise.allSettled([
  loadViewModule('flashcards'),
  loadViewModule('learn'),
  loadViewModule('typing'),
  loadViewModule('progress'),
  loadViewModule('create')
]);
