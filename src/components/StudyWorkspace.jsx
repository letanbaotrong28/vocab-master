import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRightLeft,
  BarChart2,
  BookOpen,
  BrainCircuit,
  Keyboard
} from 'lucide-react';
import { useApp } from '../context/useApp';
import { FlashcardView } from '../views/FlashcardView';
import { LearnView } from '../views/LearnView';
import { TypingView } from '../views/TypingView';
import { ProgressView } from '../views/ProgressView';

const MODE_CONFIG = {
  flashcards: { label: 'Flashcards', shortLabel: 'Thẻ học', icon: BookOpen, tagClass: '' },
  learn: { label: 'Học bài / Trắc nghiệm', shortLabel: 'Học bài', icon: BrainCircuit, tagClass: 'learn' },
  typing: { label: 'Gõ từ & Luyện gõ', shortLabel: 'Gõ từ', icon: Keyboard, tagClass: 'typing' },
  progress: { label: 'Thống kê & Tiến trình học', shortLabel: 'Tiến trình', icon: BarChart2, tagClass: 'progress' }
};

const LEARN_DIRECTIONS = [
  ['en_to_vn', 'Tiếng Anh → Tiếng Việt'],
  ['vn_to_en', 'Tiếng Việt → Tiếng Anh'],
  ['mix', 'Mix (Xáo trộn)'],
  ['ex_en_to_vn', 'Câu ví dụ: Tiếng Anh → Tiếng Việt'],
  ['ex_vn_to_en', 'Câu ví dụ: Tiếng Việt → Tiếng Anh'],
  ['ex_mix', 'Câu ví dụ: Mix']
];

const TYPING_DIRECTIONS = [
  ['vn_to_en', 'Tiếng Việt → Gõ Tiếng Anh'],
  ['en_to_vn', 'Tiếng Anh → Gõ Tiếng Việt'],
  ['mix', 'Mix (Xáo trộn)'],
  ['ex_vn_to_en', 'Câu ví dụ: Tiếng Việt → Gõ Tiếng Anh'],
  ['ex_en_to_vn', 'Câu ví dụ: Tiếng Anh → Gõ Tiếng Việt'],
  ['ex_mix', 'Câu ví dụ: Mix']
];

export const StudyWorkspace = ({ activeView }) => {
  const { currentSet, navigateTo } = useApp();
  const [learnDirection, setLearnDirection] = useState('en_to_vn');
  const [typingDirection, setTypingDirection] = useState('vn_to_en');

  if (!currentSet || !MODE_CONFIG[activeView]) return null;

  const mode = MODE_CONFIG[activeView];
  const ModeIcon = mode.icon;
  const directionOptions = activeView === 'learn'
    ? LEARN_DIRECTIONS
    : (activeView === 'typing' ? TYPING_DIRECTIONS : null);
  const direction = activeView === 'learn' ? learnDirection : typingDirection;
  const setDirection = activeView === 'learn' ? setLearnDirection : setTypingDirection;
  const modeClass = activeView === 'flashcards' ? 'flashcard-view' : `${activeView}-view`;

  return (
    <div className={`study-view ${modeClass} container`}>
      <div className="study-header">
        <button type="button" className="btn btn-ghost" onClick={() => navigateTo('home')}>
          <ArrowLeft size={20} />
          Quay lại
        </button>

        <div className="study-title-group">
          <h2>{currentSet.title}</h2>
          <span className={`mode-tag ${mode.tagClass}`.trim()}>
            <ModeIcon size={15} /> {mode.label}
          </span>
        </div>

        <div className={directionOptions ? 'direction-mode-header' : undefined}>
          {directionOptions && (
            <div className="direction-select-group">
              <ArrowRightLeft size={16} className="text-muted" />
              <select
                className="direction-select"
                value={direction}
                onChange={event => setDirection(event.target.value)}
                aria-label={activeView === 'learn' ? 'Chọn hướng câu hỏi' : 'Chọn hướng gõ từ'}
              >
                {directionOptions.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          )}

          <nav className="study-mode-nav" aria-label="Chuyển chế độ học">
            {Object.entries(MODE_CONFIG).map(([view, config]) => {
              const Icon = config.icon;
              const isActive = view === activeView;
              return (
                <button
                  key={view}
                  type="button"
                  className={`nav-mode-btn ${isActive ? 'active' : ''}`.trim()}
                  onClick={isActive ? undefined : () => navigateTo(view, currentSet.id)}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={isActive ? config.shortLabel : `Chuyển sang ${config.shortLabel}`}
                >
                  <Icon size={18} />
                  <span className="nav-mode-label">{config.shortLabel}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="study-mode-panel">
        {activeView === 'flashcards' && <FlashcardView embedded />}
        {activeView === 'learn' && (
          <LearnView embedded direction={learnDirection} onDirectionChange={setLearnDirection} />
        )}
        {activeView === 'typing' && (
          <TypingView embedded direction={typingDirection} onDirectionChange={setTypingDirection} />
        )}
        {activeView === 'progress' && <ProgressView embedded />}
      </div>
    </div>
  );
};
