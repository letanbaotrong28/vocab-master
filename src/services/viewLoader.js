const viewImporters = {
  create: () => import('../views/SetEditorView'),
  edit: () => import('../views/SetEditorView'),
  flashcards: () => import('../views/FlashcardView'),
  learn: () => import('../views/LearnView'),
  typing: () => import('../views/TypingView'),
  progress: () => import('../views/ProgressView')
};

const moduleCache = new Map();

export const loadViewModule = view => {
  const importer = viewImporters[view];
  if (!importer) return Promise.resolve(null);
  if (!moduleCache.has(view)) moduleCache.set(view, importer());
  return moduleCache.get(view);
};

export const prepareViewForNavigation = async (view, minimumDelay = 160) => {
  if (!viewImporters[view]) return;
  await Promise.all([
    loadViewModule(view),
    new Promise(resolve => window.setTimeout(resolve, minimumDelay))
  ]);
};
