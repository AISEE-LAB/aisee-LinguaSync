import { useState, useEffect, useRef } from 'react';
import { Sparkles, X, ChevronUp, ChevronDown, Move, BookOpen, Mic, CheckSquare, Smartphone, QrCode, MessageSquare, Volume2 } from 'lucide-react';

// ---------- 类型定义 ----------

interface SubtitleSegment {
  text: string;
  isTerm?: boolean;
  isAction?: boolean;
  definition?: string;
}

interface DraftEvent {
  time: number;
  type: 'draft';
  speaker: string;
  content: string;
}

interface FinalEvent {
  time: number;
  type: 'final';
  speaker: string;
  content: SubtitleSegment[];
}

interface ActionEvent {
  time: number;
  type: 'action';
  text: string;
  owner: string;
  deadline: string;
}

type ScriptEvent = DraftEvent | FinalEvent | ActionEvent;

interface HistoryRecord {
  speaker: string | null;
  content: SubtitleSegment[];
}

interface TodoItem {
  id: number;
  text: string;
  owner: string;
  deadline: string;
  done: boolean;
}

interface HoveredTerm {
  term: string;
  definition: string;
}

interface WidgetConfig {
  opacity: number;
  fontSize: string;
  showDraft: boolean;
}

// ---------- 模拟脚本 ----------

const simulationScript: ScriptEvent[] = [
  { time: 1, type: 'draft', speaker: 'Host', content: "Let's sync on" },
  { time: 2, type: 'draft', speaker: 'Host', content: "Let's sync on Project Apollo." },
  { time: 3, type: 'final', speaker: 'Host', content: [{ text: '我们来同步一下' }, { text: '阿波罗项目', isTerm: true, definition: '【私有词库匹配】公司内部下一代 AI 核心引擎的代号。' }, { text: '的进度。' }] },

  { time: 5, type: 'draft', speaker: 'Dev', content: 'Sure. I have deployed' },
  { time: 6, type: 'draft', speaker: 'Dev', content: 'Sure. I have deployed the new cluster.' },
  { time: 7, type: 'final', speaker: 'Dev', content: [{ text: '没问题。我已经部署了新的集群。' }] },

  { time: 9, type: 'draft', speaker: 'Dev', content: 'And I will send the final report' },
  { time: 10, type: 'draft', speaker: 'Dev', content: 'And I will send the final report by this Friday.' },
  { time: 11, type: 'final', speaker: 'Dev', content: [{ text: '并且我会在' }, { text: '本周五之前发送最终报告', isAction: true }, { text: '。' }] },
  { time: 11, type: 'action', text: '发送最终数据报告', owner: 'Dev', deadline: '本周五' },

  { time: 13, type: 'draft', speaker: 'Host', content: 'Excellent. Please also CC' },
  { time: 14, type: 'draft', speaker: 'Host', content: 'Excellent. Please also CC the marketing team.' },
  { time: 15, type: 'final', speaker: 'Host', content: [{ text: '非常好。' }, { text: '请抄送给市场团队', isAction: true }, { text: '。' }] },
  { time: 15, type: 'action', text: '抄送进度报告给市场团队', owner: 'Dev', deadline: '随报告' },
];

// ---------- 主组件 ----------

export default function UltimateWidgetApp() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [, setCurrentTime] = useState(0);

  // UI 状态
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'history' | 'todos'>('history');
  const [position, setPosition] = useState({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [isSpeakingReverse, setIsSpeakingReverse] = useState(false);

  // 数据状态
  const [draftSubtitle, setDraftSubtitle] = useState('');
  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);
  const [finalSubtitle, setFinalSubtitle] = useState<SubtitleSegment[]>([]);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [hoveredTerm, setHoveredTerm] = useState<HoveredTerm | null>(null);

  const [widgetConfig] = useState<WidgetConfig>({ opacity: 85, fontSize: 'text-xl', showDraft: true });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);

  // --- 拖拽逻辑 ---
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.drag-handle')) setIsDragging(true);
  };
  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) setPosition(prev => ({ x: prev.x + e.movementX, y: prev.y + e.movementY }));
  };
  const handleMouseUp = () => setIsDragging(false);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // --- 播放引擎 ---
  useEffect(() => {
    if (isPlaying && !isSpeakingReverse) {
      timerRef.current = setInterval(() => {
        setCurrentTime((prev) => {
          const nextTime = prev + 1;
          processScript(nextTime);
          return nextTime;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isPlaying, isSpeakingReverse, finalSubtitle]);

  const processScript = (time: number) => {
    const events = simulationScript.filter(event => event.time === time);

    events.forEach(event => {
      if (event.type === 'draft') {
        setDraftSubtitle(event.content);
        setCurrentSpeaker(event.speaker);
      } else if (event.type === 'final') {
        if (finalSubtitle.length > 0) {
          setHistory(prev => [...prev, { speaker: currentSpeaker, content: finalSubtitle }]);
        }
        setFinalSubtitle(event.content);
        setCurrentSpeaker(event.speaker);
        setDraftSubtitle('');
      } else if (event.type === 'action') {
        setTodos(prev => [...prev, { id: Date.now(), text: event.text, owner: event.owner, deadline: event.deadline, done: false }]);
        setIsExpanded(true);
        setActiveTab('todos');
      }
    });

    if (time > 18) {
      setCurrentTime(0);
      setDraftSubtitle('');
      setFinalSubtitle([]);
      setCurrentSpeaker(null);
      setIsPlaying(false);
    }
  };

  useEffect(() => {
    if (isExpanded && activeTab === 'history') {
      historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [history, finalSubtitle, isExpanded, activeTab]);

  const getSpeakerColor = (speaker: string | null) => {
    if (speaker === 'Host') return 'text-indigo-400 bg-indigo-500/20 border-indigo-500/30';
    if (speaker === 'Dev') return 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30';
    return 'text-slate-400 bg-slate-500/20 border-slate-500/30';
  };

  return (
    <div className="relative w-full h-screen bg-slate-200 overflow-hidden bg-[url('https://images.unsplash.com/photo-1573164713988-8665fc963095?q=80&w=2069&auto=format&fit=crop')] bg-cover bg-center">
      {/* 模拟浏览器顶栏 */}
      <div className="absolute top-0 w-full h-12 bg-white/90 backdrop-blur-sm border-b shadow-sm flex items-center px-4 space-x-2 z-0">
         <div className="flex space-x-1.5"><div className="w-3 h-3 rounded-full bg-red-400"></div><div className="w-3 h-3 rounded-full bg-yellow-400"></div><div className="w-3 h-3 rounded-full bg-green-400"></div></div>
         <div className="mx-4 px-4 py-1.5 bg-slate-100 rounded-md text-xs text-slate-500 w-1/3 flex items-center font-mono">zoom.us/j/987654321</div>
         <div className="ml-auto flex space-x-2">
            <button onClick={() => setShowQRModal(true)} className="px-3 py-1 bg-slate-800 text-white rounded text-xs hover:bg-slate-700 flex items-center transition-colors cursor-pointer">
              <Smartphone size={14} className="mr-1"/> 手机副屏
            </button>
            <button onClick={() => setIsPlaying(!isPlaying)} className="px-3 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-500 transition-colors shadow-md w-32 flex justify-center cursor-pointer">
              {isPlaying ? '⏸ 暂停同传' : '▶️ 开始同传'}
            </button>
         </div>
      </div>

      {/* 悬浮窗主体 */}
      <div
        ref={widgetRef}
        className={`absolute z-50 flex flex-col shadow-2xl transition-all duration-300 ${isDragging ? 'cursor-grabbing' : ''}`}
        style={{
            left: `${position.x}px`, top: `${position.y}px`,
            width: isExpanded ? '420px' : '650px',
            transform: isExpanded ? 'none' : 'translate(-50%, 0)',
            maxWidth: '90vw'
        }}
        onMouseDown={handleMouseDown}
      >

        {/* 控制条 */}
        <div className="drag-handle bg-slate-900/95 backdrop-blur-md rounded-t-xl border border-slate-700 border-b-0 p-2 flex items-center justify-between cursor-grab group">
            <div className="flex items-center space-x-2 opacity-50 group-hover:opacity-100 transition-opacity pl-1">
                <Move size={14} className="text-slate-400" />
            </div>

            <div className="flex items-center space-x-2">
                {isPlaying && !isSpeakingReverse && <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>}
                {isSpeakingReverse && <div className="w-1.5 h-1.5 bg-rose-400 rounded-full animate-pulse"></div>}
                <span className="text-xs font-semibold text-slate-300 tracking-wider">LINGUASYNC <span className="text-indigo-400 ml-1">PRO</span></span>
            </div>

            <div className="flex items-center space-x-1 pr-1">
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-xs text-slate-300 transition-colors flex items-center border border-slate-700 cursor-pointer"
                >
                  {isExpanded ? <ChevronDown size={14} className="mr-1"/> : <ChevronUp size={14} className="mr-1"/>}
                  {isExpanded ? '收起面板' : '展开面板'}
                  {todos.length > 0 && !isExpanded && <span className="ml-1 w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>}
                </button>
            </div>
        </div>

        {/* 核心字幕区 */}
        <div
            className={`backdrop-blur-xl border border-slate-700 p-4 min-h-[100px] flex flex-col justify-end relative shadow-inner overflow-visible transition-all duration-300 ${isSpeakingReverse ? 'border-rose-500/50' : ''}`}
            style={{ backgroundColor: isSpeakingReverse ? 'rgba(30, 20, 30, 0.95)' : `rgba(15, 23, 42, ${widgetConfig.opacity / 100})` }}
        >
            {hoveredTerm && (
                <div className="absolute bottom-[110%] left-1/2 transform -translate-x-1/2 w-64 bg-slate-800 border border-indigo-500/50 rounded-lg shadow-xl p-3 z-[60]">
                    <div className="flex items-center mb-1.5 space-x-1.5">
                        <BookOpen size={14} className="text-indigo-400" />
                        <h4 className="text-sm font-bold text-slate-100">{hoveredTerm.term}</h4>
                        <span className="ml-auto text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 rounded">私有词库</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">{hoveredTerm.definition}</p>
                </div>
            )}

            {/* 反向翻译（嘴替）界面层 */}
            {isSpeakingReverse ? (
               <div className="flex flex-col items-center justify-center py-2">
                   <div className="flex items-center space-x-3 mb-2">
                       <Mic className="text-rose-400 animate-pulse" size={24} />
                       <span className="text-rose-200 font-medium">正在聆听您的中文...</span>
                   </div>
                   <div className="text-slate-400 text-sm italic">&quot;系统将使用您的音色自动输出英文&quot;</div>
               </div>
            ) : (
                <>
                    {/* 草稿轨 + 声纹标识 */}
                    {widgetConfig.showDraft && (
                        <div className="min-h-[24px] mb-1 text-center transition-all flex justify-center items-center">
                        {draftSubtitle && (
                            <div className="flex items-center bg-black/40 px-3 py-0.5 rounded-full border border-slate-700/50 max-w-full">
                                {currentSpeaker && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded mr-2 border font-mono ${getSpeakerColor(currentSpeaker)}`}>
                                        {currentSpeaker}
                                    </span>
                                )}
                                <span className="text-slate-400 text-sm italic truncate">{draftSubtitle}</span>
                            </div>
                        )}
                        </div>
                    )}

                    {/* 精确轨道 */}
                    <div className="text-center mt-1">
                        {finalSubtitle.length > 0 ? (
                            <div className={`${widgetConfig.fontSize} font-medium text-white drop-shadow-md leading-relaxed transition-all flex items-start justify-center flex-wrap`}>
                            {!widgetConfig.showDraft && currentSpeaker && (
                                <span className={`text-xs px-2 py-0.5 rounded mt-1.5 mr-2 border font-mono ${getSpeakerColor(currentSpeaker)}`}>
                                    {currentSpeaker}
                                </span>
                            )}
                            {finalSubtitle.map((segment, index) => (
                                segment.isTerm ? (
                                <span
                                    key={index} className="relative inline-block cursor-help group"
                                    onMouseEnter={() => setHoveredTerm({ term: segment.text, definition: segment.definition || '' })}
                                    onMouseLeave={() => setHoveredTerm(null)}
                                >
                                    <span className="text-indigo-300 border-b-2 border-dashed border-indigo-400/50 mx-0.5">{segment.text}</span>
                                </span>
                                ) : segment.isAction ? (
                                    <span key={index} className="bg-amber-500/20 text-amber-200 px-1 rounded mx-0.5 border-b border-amber-500/50">
                                        {segment.text}
                                    </span>
                                ) : (
                                <span key={index}>{segment.text}</span>
                                )
                            ))}
                            </div>
                        ) : (
                            <span className="text-xl text-transparent select-none">.</span>
                        )}
                    </div>
                </>
            )}
        </div>

        {/* 跨语言嘴替 (Push to talk) 按钮区 */}
        <div className="bg-slate-900 border border-slate-700 border-t-0 p-2 flex justify-center shadow-inner relative z-10">
            <button
                onMouseDown={() => setIsSpeakingReverse(true)}
                onMouseUp={() => setIsSpeakingReverse(false)}
                onMouseLeave={() => setIsSpeakingReverse(false)}
                className={`w-full py-2 rounded-lg flex items-center justify-center space-x-2 font-medium transition-all duration-200 cursor-pointer ${isSpeakingReverse ? 'bg-rose-500 text-white shadow-[0_0_15px_rgba(244,63,94,0.5)] scale-[0.98]' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600'}`}
            >
                {isSpeakingReverse ? <Volume2 size={16} className="animate-pulse" /> : <Mic size={16} />}
                <span>{isSpeakingReverse ? '松开自动翻译并播放英文' : '按住说话 (跨语言替身)'}</span>
            </button>
        </div>

        {/* 展开的智能侧边栏 */}
        {isExpanded && (
            <div
                className="backdrop-blur-xl border border-slate-700 border-t-0 rounded-b-xl flex flex-col transition-colors duration-200"
                style={{ backgroundColor: `rgba(15, 23, 42, ${Math.min((widgetConfig.opacity + 10) / 100, 1)})`, height: '220px' }}
            >
                {/* 选项卡 */}
                <div className="flex border-b border-slate-800">
                    <button
                        onClick={() => setActiveTab('history')}
                        className={`flex-1 py-2 text-xs font-medium flex items-center justify-center transition-colors cursor-pointer ${activeTab === 'history' ? 'bg-slate-800/80 text-white border-b-2 border-indigo-500' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
                    >
                        <MessageSquare size={14} className="mr-1.5" /> 会议记录
                    </button>
                    <button
                        onClick={() => setActiveTab('todos')}
                        className={`flex-1 py-2 text-xs font-medium flex items-center justify-center transition-colors relative cursor-pointer ${activeTab === 'todos' ? 'bg-slate-800/80 text-white border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
                    >
                        <CheckSquare size={14} className="mr-1.5" /> 智能待办
                        {todos.length > 0 && <span className="ml-1.5 bg-amber-500 text-black px-1.5 py-0.5 rounded-full text-[10px] font-bold">{todos.length}</span>}
                    </button>
                </div>

                {/* 面板内容 */}
                <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                    {/* 会议记录 Tab */}
                    {activeTab === 'history' && (
                        <div className="space-y-1">
                            {history.length === 0 && finalSubtitle.length === 0 && <div className="text-xs text-slate-500 text-center mt-4">暂无记录</div>}
                            {history.map((record, idx) => (
                                <div key={idx} className="text-sm px-2 py-1.5 hover:bg-slate-800/50 rounded transition-colors group flex">
                                    <span className={`text-xs px-1.5 py-0.5 rounded mr-2 border font-mono whitespace-nowrap h-fit ${getSpeakerColor(record.speaker)}`}>
                                        {record.speaker || 'Unk'}
                                    </span>
                                    <span className="text-slate-300 mt-0.5">{record.content.map(s => s.text).join('')}</span>
                                </div>
                            ))}
                            {finalSubtitle.length > 0 && (
                                <div className="text-sm px-2 py-1.5 bg-slate-800/40 rounded border-l-2 border-indigo-500 flex">
                                    <span className={`text-xs px-1.5 py-0.5 rounded mr-2 border font-mono whitespace-nowrap h-fit opacity-70 ${getSpeakerColor(currentSpeaker)}`}>
                                        {currentSpeaker || 'Unk'}
                                    </span>
                                    <span className="text-slate-200 mt-0.5">{finalSubtitle.map(s => s.text).join('')}</span>
                                </div>
                            )}
                            <div ref={historyEndRef} />
                        </div>
                    )}

                    {/* 智能待办 Tab */}
                    {activeTab === 'todos' && (
                        <div className="space-y-2 p-1">
                            {todos.length === 0 ? (
                                <div className="text-xs text-slate-500 text-center mt-6 flex flex-col items-center">
                                    <Sparkles size={20} className="mb-2 opacity-50" />
                                    AI 将自动嗅探会议中的任务分配
                                </div>
                            ) : (
                                todos.map(todo => (
                                    <div key={todo.id} className="bg-slate-800/80 border border-slate-700 p-2.5 rounded-lg flex items-start group">
                                        <input type="checkbox" className="mt-1 mr-3 accent-amber-500 w-4 h-4 rounded border-slate-600 bg-slate-700 cursor-pointer" />
                                        <div className="flex-1">
                                            <p className="text-sm text-slate-200 leading-snug">{todo.text}</p>
                                            <div className="flex items-center mt-2 space-x-2">
                                                <span className="text-[10px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded font-mono">负责人: {todo.owner}</span>
                                                <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded">⏰ {todo.deadline}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </div>
        )}

        {!isExpanded && <div className="bg-slate-900 border border-slate-700 border-t-0 rounded-b-xl h-1"></div>}
      </div>

      {/* 手机副屏弹窗 Modal */}
      {showQRModal && (
         <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
             <div className="bg-white rounded-2xl p-6 flex flex-col items-center max-w-sm w-full shadow-2xl">
                 <div className="w-full flex justify-end"><button onClick={() => setShowQRModal(false)} className="text-slate-400 hover:text-slate-800 cursor-pointer"><X size={20}/></button></div>
                 <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mb-4"><Smartphone className="text-indigo-600" size={32} /></div>
                 <h3 className="text-xl font-bold text-slate-800 mb-2">启用手机副屏</h3>
                 <p className="text-sm text-slate-500 text-center mb-6">使用手机微信或相机扫码，手机将化身实时提词器和会议大纲，释放电脑屏幕空间。</p>

                 <div className="w-48 h-48 bg-slate-100 rounded-xl flex items-center justify-center mb-6 border-2 border-dashed border-slate-300 relative group overflow-hidden">
                    <QrCode size={120} className="text-slate-800" />
                    <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.8)] animate-[scan_2s_ease-in-out_infinite]"></div>
                 </div>

                 <p className="text-xs text-slate-400 font-mono">会话密钥: LINGUA-982-SYNC</p>
             </div>
         </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #475569; border-radius: 10px; }
        @keyframes scan {
            0% { top: 0%; opacity: 0; }
            10% { opacity: 1; }
            90% { opacity: 1; }
            100% { top: 100%; opacity: 0; }
        }
      `}} />
    </div>
  );
}
