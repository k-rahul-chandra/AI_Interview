import { useState, useRef, useEffect, useCallback } from 'react';

// Browser fallback types
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

export const useVoice = (
  ws: WebSocket | null,
  hasBackendVoice: boolean,
  onTranscriptUpdate: (text: string) => void,
  onSpeechEnd?: () => void
) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioIntervalRef = useRef<any>(null);
  const audioElementsRef = useRef<HTMLAudioElement[]>([]);
  const timerRef = useRef<any>(null);

  // Initialize Speech Recognition fallback
  useEffect(() => {
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';

      rec.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        const fullTranscript = finalTranscript || interimTranscript;
        if (fullTranscript.trim()) {
          onTranscriptUpdate(fullTranscript);
        }
      };

      rec.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        if (event.error === 'not-allowed') {
          setMicPermission('denied');
          setErrorMessage('Microphone access is blocked. Please enable it in browser settings.');
        }
      };

      recognitionRef.current = rec;
    }
  }, [onTranscriptUpdate]);

  // Handle timer for recording duration
  useEffect(() => {
    if (isRecording) {
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop the stream immediately, we just wanted to check/ask for permission
      stream.getTracks().forEach((track) => track.stop());
      setMicPermission('granted');
      setErrorMessage(null);
      return true;
    } catch (err: any) {
      console.error('Mic permission denied', err);
      setMicPermission('denied');
      setErrorMessage('Microphone access denied. Please allow microphone access to use voice.');
      return false;
    }
  }, []);

  const startRecording = useCallback(async () => {
    setErrorMessage(null);
    const hasPermission = await requestPermission();
    if (!hasPermission) return;

    // Stop any current voice playback
    stopSpeaking();

    setIsRecording(true);

    if (hasBackendVoice) {
      // CLOUD MODE: Stream raw audio chunks to WebSocket
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Setup MediaRecorder
        // Check supported MIME type
        let mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/ogg';
        }
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = ''; // Let browser decide
        }

        const mediaRecorder = mimeType 
          ? new MediaRecorder(stream, { mimeType }) 
          : new MediaRecorder(stream);
          
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0 && ws && ws.readyState === WebSocket.OPEN) {
            // Send binary blob directly over WebSocket
            event.data.arrayBuffer().then((buffer) => {
              ws.send(buffer);
            });
          }
        };

        // Collect audio slice every 250ms and send it
        mediaRecorder.start(250);
      } catch (err: any) {
        console.error('Failed to start media recorder', err);
        setErrorMessage('Could not access microphone for streaming.');
        setIsRecording(false);
      }
    } else {
      // LOCAL FALLBACK MODE: Use browser SpeechRecognition
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch (e) {
          console.warn('Recognition already started', e);
        }
      } else {
        setErrorMessage('Speech recognition is not supported in this browser.');
      }
    }
  }, [hasBackendVoice, requestPermission, ws]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);

    if (hasBackendVoice) {
      // CLOUD MODE: Stop MediaRecorder, send process_audio command
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        // Stop all tracks on the stream to release mic indicator
        const stream = mediaRecorderRef.current.stream;
        stream.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
      }
      
      // Let the backend know we finished recording and it should process the audio
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(jsonMessage('process_audio'));
      }
    } else {
      // LOCAL FALLBACK MODE: Stop speech recognition
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          console.warn('Recognition already stopped', e);
        }
      }
    }
  }, [hasBackendVoice, ws]);

  const playBase64 = useCallback((base64Audio: string) => {
    try {
      stopSpeaking();
      setIsPlaying(true);

      const binaryString = window.atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const blob = new Blob([bytes], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      
      audio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(url);
        if (onSpeechEnd) onSpeechEnd();
      };

      audio.onerror = (e) => {
        console.error('Audio playback error', e);
        setIsPlaying(false);
      };

      audioElementsRef.current.push(audio);
      audio.play().catch((err) => {
        console.error('Play was blocked by browser or failed', err);
        setIsPlaying(false);
      });
    } catch (e) {
      console.error('Error playing base64 audio', e);
      setIsPlaying(false);
    }
  }, [onSpeechEnd]);

  const speakText = useCallback((text: string) => {
    stopSpeaking();
    setIsPlaying(true);

    if ('speechSynthesis' in window) {
      // Cancel current speaking
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      
      // Custom voice matching
      const voices = window.speechSynthesis.getVoices();
      // Try to find a premium English voice (e.g. Google US English, Samantha, Microsoft Zira)
      const preferredVoice = voices.find(
        (v) => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha'))
      ) || voices.find((v) => v.lang.startsWith('en'));
      
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      utterance.onend = () => {
        setIsPlaying(false);
        if (onSpeechEnd) onSpeechEnd();
      };

      utterance.onerror = (e) => {
        console.error('SpeechSynthesis error', e);
        setIsPlaying(false);
      };

      window.speechSynthesis.speak(utterance);
    } else {
      console.warn('SpeechSynthesis not supported on this browser');
      setIsPlaying(false);
      if (onSpeechEnd) onSpeechEnd();
    }
  }, [onSpeechEnd]);

  const stopSpeaking = useCallback(() => {
    setIsPlaying(false);
    
    // Stop HTML Audio Elements
    audioElementsRef.current.forEach((audio) => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (e) {}
    });
    audioElementsRef.current = [];

    // Stop SpeechSynthesis
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const clearError = () => setErrorMessage(null);

  // Helper function to stringify JSON websocket commands
  const jsonMessage = (type: string, extra = {}) => {
    return JSON.stringify({ type, ...extra });
  };

  return {
    isRecording,
    isPlaying,
    micPermission,
    errorMessage,
    recordingTime,
    startRecording,
    stopRecording,
    playBase64,
    speakText,
    stopSpeaking,
    requestPermission,
    clearError,
  };
};
