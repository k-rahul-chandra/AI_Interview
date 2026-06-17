import React, { useState, useEffect, useRef } from 'react';
import { 
  Atom, 
  Brain, 
  Database, 
  Users, 
  Mic, 
  MicOff, 
  Send, 
  Clock, 
  ArrowLeft, 
  CheckCircle2, 
  Trash2, 
  History, 
  Sparkles, 
  Volume2, 
  VolumeX, 
  Loader2,
  AlertCircle,
  FileText
} from 'lucide-react';
import { useVoice } from './hooks/useVoice';
import { Waveform } from './components/Waveform';

interface ChatMessage {
  sender: 'interviewer' | 'candidate';
  text: string;
}

interface FeedbackReport {
  clarity: number;
  technical_depth: number;
  confidence: number;
  summary: string;
  suggestions: string[];
}

interface SavedInterview {
  id: string;
  date: string;
  time: string;
  type: string;
  duration: string;
  report: FeedbackReport;
}

export default function App() {
  // Navigation & session state
  const [currentView, setCurrentView] = useState<'select' | 'interview' | 'report' | 'history'>('select');
  const [selectedPreset, setSelectedPreset] = useState<string>('React Developer');
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [hasBackendVoice, setHasBackendVoice] = useState(false);
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  
  // Interview progress state
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
  const [questionCount, setQuestionCount] = useState(1);
  const [maxQuestions, setMaxQuestions] = useState(6);
  const [userTranscript, setUserTranscript] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedbackReport, setFeedbackReport] = useState<FeedbackReport | null>(null);
  const [showHistoryDetail, setShowHistoryDetail] = useState<SavedInterview | null>(null);
  
  // Connection and timing refs
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const timerRef = useRef<any>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // Initialize Voice hook
  const {
    isRecording,
    isPlaying,
    errorMessage,
    recordingTime,
    startRecording,
    stopRecording,
    playBase64,
    speakText,
    stopSpeaking,
    clearError,
  } = useVoice(
    ws,
    hasBackendVoice,
    (text) => setUserTranscript(text), // Handles live fallback STT transcript
    () => console.log('Interviewer speech playback completed.')
  );

  // Auto-scroll transcript window
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory]);

  // Duration timer for room
  useEffect(() => {
    if (currentView === 'interview') {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentView]);

  const formatDuration = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Connect to backend WebSocket and initiate interview
  const startInterview = (presetName: string) => {
    setSelectedPreset(presetName);
    setChatHistory([]);
    setCurrentQuestion('');
    setUserTranscript('');
    setFeedbackReport(null);
    setIsProcessing(true);
    setWsStatus('connecting');

    // Create WebSocket URL
    const isSecure = window.location.protocol === 'https:';
    const backendHost = import.meta.env.VITE_WS_URL || 'localhost:8000';
    const wsUrl = backendHost.startsWith('ws://') || backendHost.startsWith('wss://')
      ? backendHost
      : `${isSecure ? 'wss:' : 'ws:'}//${backendHost}/ws/interview`;

    try {
      const socket = new WebSocket(wsUrl);
      setWs(socket);

      socket.onopen = () => {
        setWsStatus('connected');
        clearError();
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'handshake') {
            setHasBackendVoice(data.has_openai);
            // Send starting preset
            socket.send(JSON.stringify({
              type: 'start',
              interview_type: presetName
            }));
          } 
          
          else if (data.type === 'question') {
            const text = data.text;
            setCurrentQuestion(text);
            setQuestionCount(data.question_count || 1);
            setMaxQuestions(data.max_questions || 6);
            setIsProcessing(false);
            
            // Append to chat
            setChatHistory((prev) => [...prev, { sender: 'interviewer', text }]);
            
            // Text to speech
            if (!isMuted) {
              if (data.audio && data.audio.trim() !== '') {
                playBase64(data.audio);
              } else {
                speakText(text);
              }
            }
          } 
          
          else if (data.type === 'processing') {
            setIsProcessing(true);
          } 
          
          else if (data.type === 'report') {
            const report = data.report as FeedbackReport;
            setFeedbackReport(report);
            setIsProcessing(false);
            
            // Save to localStorage
            saveToHistory(presetName, report);
            
            // Stop WebSocket connection gracefully
            socket.close();
            setCurrentView('report');
          } 
          
          else if (data.type === 'transcription_error') {
            setIsProcessing(false);
            alert(data.message);
          }
          
          else if (data.type === 'error') {
            setIsProcessing(false);
            console.error('WebSocket server error:', data.message);
          }
        } catch (err) {
          console.error('Failed parsing message payload', err);
        }
      };

      socket.onerror = (e) => {
        console.error('WebSocket connection error:', e);
        setWsStatus('disconnected');
        setIsProcessing(false);
      };

      socket.onclose = () => {
        console.log('WebSocket connection closed.');
        setWsStatus('disconnected');
        setIsProcessing(false);
      };

      setCurrentView('interview');
    } catch (e) {
      console.error('WebSocket initialization failure:', e);
      setWsStatus('disconnected');
      setIsProcessing(false);
    }
  };

  const handleTextSubmit = () => {
    if (!userTranscript.trim() || isProcessing) return;

    // Stop speaking/playing
    stopSpeaking();

    const textAnswer = userTranscript.trim();
    
    // Add to chat history immediately
    setChatHistory((prev) => [...prev, { sender: 'candidate', text: textAnswer }]);
    
    // Send to WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'text_answer',
        text: textAnswer
      }));
      setUserTranscript('');
      setIsProcessing(true);
    } else {
      // Offline fallback simulator
      handleOfflineTurn(textAnswer);
    }
  };

  // Simulates interview state progression offline or on WebSocket drop
  const handleOfflineTurn = (_text: string) => {
    setUserTranscript('');
    setIsProcessing(true);

    setTimeout(() => {
      setQuestionCount((prev) => {
        const nextVal = prev + 1;
        if (nextVal > maxQuestions) {
          // Finish and generate report
          const mockReport: FeedbackReport = {
            clarity: 7,
            technical_depth: 8,
            confidence: 6,
            summary: "Completed via local fallback mode. Good overall logic structure. Make sure to specify concrete production architectural frameworks, metrics, and quantitative achievements in your answers.",
            suggestions: [
              "Elaborate on database transactional consistency patterns like Saga/Outbox.",
              "Articulate performance monitoring tools used in your past deployments.",
              "Adopt a cleaner problem-solving structure using the STAR methodology."
            ]
          };
          setFeedbackReport(mockReport);
          saveToHistory(selectedPreset, mockReport);
          setCurrentView('report');
          setIsProcessing(false);
        } else {
          // Next question
          const offlineQuestions: Record<string, string[]> = {
            "React Developer": [
              "How do you handle complex state management across pages? Context vs. Redux?",
              "Describe how you profile slow React applications and apply optimization techniques.",
              "What is your preference for CSS structure? Modules vs CSS-in-JS vs TailwindCSS?",
              "Thank you. This completes the interview. I am generating your report."
            ],
            "ML Engineer": [
              "What is the difference between L1 and L2 regularization? When to use which?",
              "Explain the self-attention mechanism in transformer models.",
              "How do you handle severe class imbalances in model datasets?",
              "Thank you. This completes the ML interview. Let's calculate the score."
            ],
            "Backend Dev": [
              "How do database transactions maintain ACID compliance? What is the Saga pattern?",
              "When do you select a document store database over a relational database?",
              "Explain connection pooling and its importance in microservice loads.",
              "Thank you. This completes the backend rounds. Creating report."
            ],
            "Behavioral": [
              "Describe a project that failed. What was your role and lessons learned?",
              "How do you prioritize deliverables when blocking issues or deadlines conflict?",
              "How do you give constructive architectural critiques during code reviews?",
              "Thank you. Behavioral review is complete. Synthesizing feedback."
            ]
          };
          const list = offlineQuestions[selectedPreset] || offlineQuestions["React Developer"];
          const qText = list[Math.min(nextVal - 2, list.length - 1)];
          setCurrentQuestion(qText);
          setChatHistory((prev) => [...prev, { sender: 'interviewer', text: qText }]);
          setIsProcessing(false);
          if (!isMuted) speakText(qText);
        }
        return nextVal;
      });
    }, 1500);
  };

  const endSessionEarly = () => {
    stopSpeaking();
    if (ws) {
      try {
        ws.send(JSON.stringify({ type: 'cancel' }));
        ws.close();
      } catch (e) {}
    }
    setWs(null);
    setCurrentView('select');
  };

  // Local history management
  const saveToHistory = (presetName: string, report: FeedbackReport) => {
    try {
      const saved: SavedInterview = {
        id: crypto.randomUUID(),
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: presetName,
        duration: formatDuration(elapsedSeconds),
        report
      };

      const existingHistory = JSON.parse(localStorage.getItem('interview_history') || '[]');
      localStorage.setItem('interview_history', JSON.stringify([saved, ...existingHistory]));
    } catch (e) {
      console.error('Error saving session to localStorage:', e);
    }
  };

  const loadHistory = (): SavedInterview[] => {
    try {
      return JSON.parse(localStorage.getItem('interview_history') || '[]');
    } catch (e) {
      return [];
    }
  };

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const history = loadHistory();
      const updated = history.filter((h) => h.id !== id);
      localStorage.setItem('interview_history', JSON.stringify(updated));
      // Trigger component re-render
      if (showHistoryDetail?.id === id) {
        setShowHistoryDetail(null);
      }
    } catch (e) {}
  };

  const clearAllHistory = () => {
    if (window.confirm('Are you sure you want to clear all interview history?')) {
      localStorage.removeItem('interview_history');
      setShowHistoryDetail(null);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 8) return 'text-emerald-400 stroke-emerald-400';
    if (score >= 6) return 'text-amber-400 stroke-amber-400';
    return 'text-rose-400 stroke-rose-400';
  };

  // Helper render components for dashboard cards
  const presets = [
    {
      name: 'React Developer',
      icon: <Atom className="w-8 h-8 text-cyan-400" />,
      desc: 'Hooks, State management, Rendering, SSR, Performance optimization.',
      color: 'from-cyan-500/10 to-indigo-500/5 hover:border-cyan-500/40'
    },
    {
      name: 'ML Engineer',
      icon: <Brain className="w-8 h-8 text-fuchsia-400" />,
      desc: 'Model training, regularization, transformers, system design, NLP/CV.',
      color: 'from-fuchsia-500/10 to-pink-500/5 hover:border-fuchsia-500/40'
    },
    {
      name: 'Backend Dev',
      icon: <Database className="w-8 h-8 text-emerald-400" />,
      desc: 'API structures, Caching, scaling, messaging, transactions, schemas.',
      color: 'from-emerald-500/10 to-teal-500/5 hover:border-emerald-500/40'
    },
    {
      name: 'Behavioral',
      icon: <Users className="w-8 h-8 text-amber-400" />,
      desc: 'STAR answers, resolving conflicts, agile culture, technical leadership.',
      color: 'from-amber-500/10 to-orange-500/5 hover:border-amber-500/40'
    }
  ];

  return (
    <div className="min-h-screen flex flex-col justify-between py-6 px-4 md:px-8">
      {/* Header Bar */}
      <header className="max-w-6xl w-full mx-auto flex justify-between items-center mb-8">
        <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => setCurrentView('select')}>
          <div className="p-2 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 shadow-lg shadow-indigo-500/30">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
              Interviewer.AI
            </h1>
            <p className="text-[10px] text-slate-400 font-medium tracking-widest uppercase">Senior Mock Board</p>
          </div>
        </div>

        {/* Global Control Header */}
        <div className="flex items-center gap-3">
          {currentView === 'select' && (
            <button
              onClick={() => setCurrentView('history')}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-sm font-semibold text-slate-300 hover:text-white hover:bg-slate-800/80 transition-all"
            >
              <History className="w-4 h-4" />
              History
            </button>
          )}

          {currentView === 'interview' && (
            <>
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                title={isMuted ? "Unmute Voice" : "Mute Voice"}
              >
                {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-indigo-400" />}
              </button>
              <button
                onClick={endSessionEarly}
                className="px-4 py-2 rounded-xl border border-red-500/30 bg-red-950/20 text-red-400 text-sm font-semibold hover:bg-red-950/50 transition-colors"
              >
                End Session
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Content Areas */}
      <main className="flex-1 flex items-center justify-center max-w-6xl w-full mx-auto">
        
        {/* VIEW 1: PRESET SELECTOR */}
        {currentView === 'select' && (
          <div className="w-full max-w-4xl animate-fade-in">
            <div className="text-center mb-10">
              <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-3 tracking-tight leading-tight">
                Refine Your Tech Communication
              </h2>
              <p className="text-slate-400 text-sm md:text-base max-w-xl mx-auto font-light">
                Choose a targeted sandbox session. Our AI agent will assess technical depth, reasoning models, clarity, and situational confidence.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {presets.map((p) => (
                <div
                  key={p.name}
                  onClick={() => startInterview(p.name)}
                  className={`p-6 rounded-2xl border bg-gradient-to-br cursor-pointer glass-panel-hover glass-panel flex gap-5 items-start ${p.color}`}
                >
                  <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80 shadow-md">
                    {p.icon}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white mb-1.5">{p.name}</h3>
                    <p className="text-xs text-slate-400 font-light leading-relaxed">{p.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Local Status Message */}
            <div className="mt-8 p-3.5 rounded-xl border border-indigo-500/10 bg-indigo-950/10 flex items-center gap-3 justify-center text-xs text-slate-400 max-w-md mx-auto">
              <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>
                Supports microphone capturing & browser synthesis fallback. Runs fully local if WebSocket backend offline.
              </span>
            </div>
          </div>
        )}

        {/* VIEW 2: INTERVIEW ROOM */}
        {currentView === 'interview' && (
          <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left/Center Panel: Current Question */}
            <div className="lg:col-span-2 flex flex-col gap-5">
              
              {/* Question Screen */}
              <div className="p-6 rounded-2xl glass-panel relative overflow-hidden flex flex-col justify-between min-h-[350px]">
                
                {/* Header indicators */}
                <div className="flex justify-between items-center mb-6">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-xs font-semibold text-indigo-300">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                    </span>
                    Question {questionCount} of {maxQuestions}
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold bg-slate-900/60 px-3 py-1.5 rounded-lg border border-slate-800">
                    <Clock className="w-3.5 h-3.5" />
                    {formatDuration(elapsedSeconds)}
                  </div>
                </div>

                {/* Question display */}
                <div className="flex-1 flex items-center justify-center py-4 text-center">
                  {isProcessing ? (
                    <div className="flex flex-col items-center gap-4 text-slate-400">
                      <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                      <p className="text-sm font-medium animate-pulse">Evaluating answer & formulating follow-up...</p>
                    </div>
                  ) : (
                    <p className="text-lg md:text-xl font-medium leading-relaxed text-slate-100 px-2">
                      {currentQuestion || "Connecting to interview server..."}
                    </p>
                  )}
                </div>

                {/* Animated Waveform Visualizer */}
                <div className="mt-6 border-t border-slate-900 pt-5">
                  <Waveform isRecording={isRecording} isPlaying={isPlaying} />
                  <p className="text-[10px] text-center text-slate-500 mt-2 font-medium tracking-wide uppercase">
                    {isRecording ? "Listening to response..." : isPlaying ? "Interviewer speaking..." : "Wave visualizer"}
                  </p>
                </div>
              </div>

              {/* Input Control Board */}
              <div className="p-4 rounded-2xl glass-panel flex flex-col gap-3">
                <div className="relative flex items-center gap-2 bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2">
                  <textarea
                    rows={2}
                    value={userTranscript}
                    onChange={(e) => setUserTranscript(e.target.value)}
                    placeholder={isRecording ? "Transcribing voice in real time..." : "Type your answer or use microphone to speak..."}
                    className="flex-1 bg-transparent resize-none outline-none border-none text-sm text-slate-200 placeholder-slate-500 pr-12 focus:ring-0"
                    disabled={isProcessing}
                  />

                  {/* Submit Button */}
                  <button
                    onClick={handleTextSubmit}
                    disabled={!userTranscript.trim() || isProcessing}
                    className={`p-2.5 rounded-lg transition-all ${
                      userTranscript.trim() && !isProcessing
                        ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md'
                        : 'bg-slate-900 text-slate-600'
                    }`}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>

                {/* Mic Record Controls */}
                <div className="flex justify-between items-center gap-2 px-1">
                  <div className="text-xs text-slate-400 font-light">
                    {errorMessage ? (
                      <span className="text-red-400 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {errorMessage}
                      </span>
                    ) : isRecording ? (
                      <span className="text-rose-400 flex items-center gap-1 animate-pulse">
                        ● Live capturing ({formatDuration(elapsedSeconds - elapsedSeconds + recordingTime)})
                      </span>
                    ) : (
                      "Press mic to start speaking"
                    )}
                  </div>

                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={isProcessing}
                    className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl font-bold text-sm shadow-md transition-all ${
                      isRecording
                        ? 'bg-gradient-to-r from-red-600 to-rose-500 hover:from-red-500 hover:to-rose-400 text-white animate-pulse'
                        : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white'
                    }`}
                  >
                    {isRecording ? (
                      <>
                        <MicOff className="w-4 h-4" />
                        Stop Mic
                      </>
                    ) : (
                      <>
                        <Mic className="w-4 h-4" />
                        Record Speech
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Right Panel: Live Conversation Transcript */}
            <div className="lg:col-span-1 rounded-2xl glass-panel p-4 flex flex-col h-[525px] overflow-hidden">
              <div className="flex items-center justify-between pb-3 border-b border-slate-900 mb-3">
                <span className="text-sm font-bold text-white flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-indigo-400" />
                  Live Transcript
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                  {wsStatus === 'connected' ? 'Cloud Live' : 'Fallback'}
                </span>
              </div>

              {/* Bubbles box */}
              <div className="flex-1 overflow-y-auto space-y-3.5 pr-1.5 scrollbar-thin">
                {chatHistory.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-center text-xs text-slate-500 px-4">
                    Transcript bubbles will render here as you speak.
                  </div>
                ) : (
                  chatHistory.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex flex-col ${msg.sender === 'interviewer' ? 'items-start' : 'items-end'}`}
                    >
                      <span className="text-[9px] text-slate-500 mb-1 font-semibold tracking-wider uppercase">
                        {msg.sender === 'interviewer' ? 'Interviewer' : 'You'}
                      </span>
                      <div
                        className={`p-3 rounded-2xl text-xs leading-relaxed max-w-[88%] font-light ${
                          msg.sender === 'interviewer'
                            ? 'bg-slate-900 text-slate-200 rounded-tl-none border border-slate-800/50'
                            : 'bg-indigo-650 text-white rounded-tr-none'
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ))
                )}
                <div ref={transcriptEndRef} />
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: REPORT VIEW */}
        {currentView === 'report' && feedbackReport && (
          <div className="w-full max-w-4xl animate-fade-in flex flex-col gap-6 py-4">
            
            {/* Top overview bar */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-5 border-b border-slate-900">
              <div>
                <span className="text-xs font-semibold text-indigo-400 tracking-wider uppercase">Evaluation Report</span>
                <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">{selectedPreset} Assessment</h2>
              </div>
              <button
                onClick={() => setCurrentView('select')}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold text-sm text-white shadow-lg shadow-indigo-600/30 transition-all hover:-translate-y-0.5"
              >
                Return to Dashboard
              </button>
            </div>

            {/* Score Ring Section */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {[
                { label: 'Communication Clarity', score: feedbackReport.clarity, desc: 'Flow and structure of answers.' },
                { label: 'Technical Depth', score: feedbackReport.technical_depth, desc: 'Use of syntax, theory, and cases.' },
                { label: 'Confidence & Delivery', score: feedbackReport.confidence, desc: 'Pace, tone, and sentence phrasing.' }
              ].map((ring, idx) => {
                const percent = ring.score * 10;
                const radius = 38;
                const circumference = 2 * Math.PI * radius;
                const offset = circumference - (percent / 100) * circumference;

                return (
                  <div key={idx} className="p-6 rounded-2xl glass-panel flex flex-col items-center text-center">
                    <span className="text-xs text-slate-400 font-semibold mb-4">{ring.label}</span>
                    
                    {/* SVG Circle */}
                    <div className="relative w-28 h-28 flex items-center justify-center mb-4">
                      <svg className="w-full h-full -rotate-90">
                        <circle
                          cx="56"
                          cy="56"
                          r={radius}
                          className="stroke-slate-900 fill-transparent"
                          strokeWidth="8"
                        />
                        <circle
                          cx="56"
                          cy="56"
                          r={radius}
                          className={`fill-transparent animate-dash ${getScoreColor(ring.score)}`}
                          strokeWidth="8"
                          strokeDasharray={circumference}
                          strokeDashoffset={offset}
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="absolute text-2xl font-black text-white">
                        {ring.score}<span className="text-xs text-slate-500 font-normal">/10</span>
                      </div>
                    </div>
                    
                    <p className="text-xs text-slate-400 leading-relaxed font-light">{ring.desc}</p>
                  </div>
                );
              })}
            </div>

            {/* Assessment Details Box */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Overall Summary */}
              <div className="lg:col-span-2 p-6 rounded-2xl glass-panel flex flex-col justify-between">
                <div>
                  <h3 className="text-base font-bold text-white mb-3.5 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-indigo-400" />
                    Overall Performance Summary
                  </h3>
                  <p className="text-sm text-slate-300 leading-relaxed font-light">
                    {feedbackReport.summary}
                  </p>
                </div>
                
                <div className="mt-6 p-4 rounded-xl border border-slate-900 bg-slate-950/40 text-xs text-slate-400 font-light">
                  Feedback is processed dynamically based on key indicators, depth of vocabulary, structured logic models, and technical correctness.
                </div>
              </div>

              {/* Action items */}
              <div className="lg:col-span-1 p-6 rounded-2xl glass-panel">
                <h3 className="text-base font-bold text-white mb-4.5 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-fuchsia-400" />
                  Improvement Areas
                </h3>
                
                <ul className="space-y-4">
                  {feedbackReport.suggestions.map((suggestion, sIdx) => (
                    <li key={sIdx} className="flex gap-3 items-start">
                      <div className="p-1 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mt-0.5 shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-xs text-slate-300 leading-normal font-light">{suggestion}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 4: HISTORY VIEW */}
        {currentView === 'history' && (
          <div className="w-full max-w-4xl animate-fade-in flex flex-col gap-6 py-4">
            
            {/* Top header */}
            <div className="flex justify-between items-center pb-5 border-b border-slate-900">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentView('select')}
                  className="p-2 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-400 hover:text-white transition-colors"
                >
                  <ArrowLeft className="w-4.5 h-4.5" />
                </button>
                <div>
                  <span className="text-xs font-semibold text-slate-500 tracking-wider uppercase">User Portal</span>
                  <h2 className="text-2xl font-extrabold text-white tracking-tight">Session History</h2>
                </div>
              </div>

              {loadHistory().length > 0 && (
                <button
                  onClick={clearAllHistory}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-xs font-semibold text-red-400 hover:bg-red-950/20 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear All
                </button>
              )}
            </div>

            {/* List box */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* History sessions log list */}
              <div className="lg:col-span-1 space-y-3 max-h-[500px] overflow-y-auto pr-1">
                {loadHistory().length === 0 ? (
                  <div className="py-12 text-center text-sm text-slate-500 border border-dashed border-slate-900 rounded-2xl">
                    No completed sessions in cache.
                  </div>
                ) : (
                  loadHistory().map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setShowHistoryDetail(item)}
                      className={`p-4 rounded-xl border cursor-pointer transition-all ${
                        showHistoryDetail?.id === item.id
                          ? 'bg-indigo-950/20 border-indigo-500/40 shadow-md shadow-indigo-500/5'
                          : 'bg-slate-900/40 border-slate-800/80 hover:bg-slate-800/55 hover:border-slate-700/60'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="text-[10px] text-slate-500 block font-semibold uppercase">{item.date} • {item.time}</span>
                          <span className="text-sm font-bold text-white">{item.type}</span>
                        </div>
                        <button
                          onClick={(e) => deleteHistoryItem(item.id, e)}
                          className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-850/50 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Micro ratings line */}
                      <div className="flex gap-3 text-[10px] font-medium text-slate-400 mt-3 pt-2.5 border-t border-slate-900">
                        <span>Clarity: <strong className="text-white">{item.report.clarity}</strong></span>
                        <span>Tech: <strong className="text-white">{item.report.technical_depth}</strong></span>
                        <span>Conf: <strong className="text-white">{item.report.confidence}</strong></span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Detail view of clicked item */}
              <div className="lg:col-span-2">
                {showHistoryDetail ? (
                  <div className="p-6 rounded-2xl glass-panel space-y-6">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 pb-4 border-b border-slate-900">
                      <div>
                        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block mb-0.5">
                          {showHistoryDetail.date} @ {showHistoryDetail.time}
                        </span>
                        <h3 className="text-lg font-bold text-white">{showHistoryDetail.type} Report</h3>
                      </div>
                      
                      <div className="text-xs text-slate-400 font-medium px-3.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
                        Duration: {showHistoryDetail.duration || '00:00'}
                      </div>
                    </div>

                    {/* Scores row */}
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { name: 'Clarity', val: showHistoryDetail.report.clarity },
                        { name: 'Technical', val: showHistoryDetail.report.technical_depth },
                        { name: 'Confidence', val: showHistoryDetail.report.confidence }
                      ].map((sc, i) => (
                        <div key={i} className="p-3.5 rounded-xl border border-slate-900 bg-slate-950/20 text-center">
                          <span className="text-[10px] text-slate-500 font-semibold uppercase block mb-1">{sc.name}</span>
                          <span className="text-xl font-black text-slate-100">{sc.val}<strong className="text-xs text-slate-600 font-normal">/10</strong></span>
                        </div>
                      ))}
                    </div>

                    {/* Report Summary */}
                    <div>
                      <h4 className="text-xs font-bold text-white mb-2 uppercase tracking-wide">Summary</h4>
                      <p className="text-xs text-slate-300 leading-relaxed font-light">
                        {showHistoryDetail.report.summary}
                      </p>
                    </div>

                    {/* Report Improvements */}
                    <div>
                      <h4 className="text-xs font-bold text-white mb-2 uppercase tracking-wide">Target Areas</h4>
                      <ul className="space-y-2.5">
                        {showHistoryDetail.report.suggestions.map((sg, sIdx) => (
                          <li key={sIdx} className="flex gap-2 text-xs text-slate-300 leading-normal font-light">
                            <span className="text-indigo-400 mt-0.5">•</span>
                            <span>{sg}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="h-[350px] flex items-center justify-center text-center text-sm text-slate-500 border border-dashed border-slate-900 rounded-2xl">
                    Select a completed interview session from the left column to view its detailed feedback report.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer copyright */}
      <footer className="max-w-6xl w-full mx-auto text-center mt-12 text-[10px] font-semibold text-slate-600 tracking-wider uppercase border-t border-slate-900 pt-6">
        © 2026 Interviewer.AI. All rights reserved. Built for engineering interviews.
      </footer>
    </div>
  );
}
