import {
  AvatarQuality,
  StreamingEvents,
  VoiceChatTransport,
  VoiceEmotion,
  StartAvatarRequest,
  STTProvider,
  ElevenLabsModel,
  TaskType,
} from "@heygen/streaming-avatar";
import { useEffect, useRef, useState } from "react";
import { useMemoizedFn, useUnmount } from "ahooks";

import { useStreamingAvatarSession } from "./logic/useStreamingAvatarSession";
import { StreamingAvatarProvider, StreamingAvatarSessionState } from "./logic";

import { AVATARS } from "@/app/lib/constants";

const DEFAULT_CONFIG: StartAvatarRequest = {
  quality: AvatarQuality.Low,
  avatarName: AVATARS[0].avatar_id,
  voice: {
    rate: 1.5,
    emotion: VoiceEmotion.EXCITED,
    model: ElevenLabsModel.eleven_flash_v2_5,
  },
  language: "ko",
  voiceChatTransport: VoiceChatTransport.WEBSOCKET,
  sttSettings: {
    provider: STTProvider.DEEPGRAM,
  },
};

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// VAD 설정
const VAD_CONFIG = {
  SILENCE_THRESHOLD: 0.01,      // 침묵 판단 기준 (낮을수록 민감)
  SPEECH_THRESHOLD: 0.02,       // 말하기 시작 판단 기준
  SILENCE_DURATION: 1500,       // 침묵 지속 시간 (ms) 후 녹음 중지
  MIN_RECORDING_TIME: 500,      // 최소 녹음 시간 (ms)
};

function InteractiveAvatar() {
  const {
    initAvatar,
    startAvatar,
    stopAvatar,
    sessionState,
    stream,
    avatarRef,
  } = useStreamingAvatarSession();

  const [config] = useState<StartAvatarRequest>(DEFAULT_CONFIG);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const mediaStream = useRef<HTMLVideoElement>(null);
  const isProcessingRef = useRef(false);
  const hasGreetedRef = useRef(false);
  const hasStartedRef = useRef(false);
  const userNameRef = useRef<string>('');
  const userStatsRef = useRef<any>(null);
  const isAvatarTalkingRef = useRef(false);  // 🆕 아바타 말하는 중 체크
  
  // 🆕 Whisper STT + VAD 관련
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const isVadActiveRef = useRef(false);
  const isRecordingRef = useRef(false);  // 🆕 동기 체크용

  async function fetchAccessToken() {
    try {
      const response = await fetch("/api/get-access-token", {
        method: "POST",
      });
      const token = await response.text();
      console.log("Access Token:", token);
      return token;
    } catch (error) {
      console.error("Error fetching access token:", error);
      throw error;
    }
  }

  // ============================================
  // 🆕 Whisper STT 함수
  // ============================================
  const transcribeWithWhisper = async (audioBlob: Blob): Promise<string> => {
    try {
      console.log("🎤 Whisper로 변환 중...", audioBlob.size, "bytes");
      
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");

      const response = await fetch("/api/whisper", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      
      if (data.error) {
        console.error("Whisper 에러:", data.error);
        return "";
      }
      
      console.log("🎤 Whisper 결과:", data.text);
      return data.text || "";
    } catch (error) {
      console.error("Whisper API 호출 실패:", error);
      return "";
    }
  };

  // ============================================
  // 🆕 VAD (Voice Activity Detection) 함수들
  // ============================================
  const getAudioLevel = (): number => {
    if (!analyserRef.current) return 0;
    
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    
    // 평균 음량 계산
    const sum = dataArray.reduce((a, b) => a + b, 0);
    const average = sum / dataArray.length / 255; // 0~1 범위로 정규화
    
    return average;
  };

  const startVAD = () => {
    if (vadIntervalRef.current) return;
    
    isVadActiveRef.current = true;
    
    vadIntervalRef.current = setInterval(() => {
      // 처리 중이거나 아바타가 말하는 중이면 무시
      if (isProcessingRef.current || isLoading || isAvatarTalkingRef.current) {
        return;
      }

      const level = getAudioLevel();
      
      if (!isRecordingRef.current) {
        // 녹음 중 아닐 때: 음성 감지되면 녹음 시작
        if (level > VAD_CONFIG.SPEECH_THRESHOLD) {
          console.log("🎤 음성 감지! 녹음 시작", level.toFixed(3));
          startRecording();
        }
      } else {
        // 녹음 중일 때: 침묵 감지되면 녹음 중지
        if (level < VAD_CONFIG.SILENCE_THRESHOLD) {
          if (!silenceStartRef.current) {
            silenceStartRef.current = Date.now();
          } else {
            const silenceDuration = Date.now() - silenceStartRef.current;
            const recordingDuration = Date.now() - (recordingStartRef.current || 0);
            
            // 최소 녹음 시간 이상이고, 침묵이 일정 시간 지속되면 중지
            if (recordingDuration > VAD_CONFIG.MIN_RECORDING_TIME && 
                silenceDuration > VAD_CONFIG.SILENCE_DURATION) {
              console.log("🔇 침묵 감지! 녹음 중지");
              stopRecording();
            }
          }
        } else {
          // 소리가 나면 침묵 타이머 리셋
          silenceStartRef.current = null;
        }
      }
    }, 100); // 100ms마다 체크
  };

  const stopVAD = () => {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    isVadActiveRef.current = false;
  };

  const startRecording = () => {
    // 🆕 ref로 동기 체크
    if (!micStreamRef.current || isRecordingRef.current) return;
    
    isRecordingRef.current = true;  // 🆕 즉시 설정
    
    try {
      const mediaRecorder = new MediaRecorder(micStreamRef.current, {
        mimeType: "audio/webm",
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      recordingStartRef.current = Date.now();
      silenceStartRef.current = null;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        
        // 너무 짧은 녹음 무시
        if (audioBlob.size < 3000) {
          console.log("녹음이 너무 짧음, 무시");
          isRecordingRef.current = false;
          setIsRecording(false);
          return;
        }

        // Whisper로 텍스트 변환
        const transcript = await transcribeWithWhisper(audioBlob);
        
        if (transcript && transcript.trim()) {
          await handleUserSpeech(transcript);
        }
        
        isRecordingRef.current = false;
        setIsRecording(false);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setIsListening(true);
    } catch (error) {
      console.error("녹음 시작 실패:", error);
      isRecordingRef.current = false;
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    isRecordingRef.current = false;  // 🆕 즉시 설정
    setIsListening(false);
    silenceStartRef.current = null;
  };

  // ============================================
  // 🆕 마이크 + VAD 초기화
  // ============================================
  const initMicAndVAD = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      
      // AudioContext 설정
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);
      
      setMicEnabled(true);
      console.log("🎤 마이크 + VAD 초기화 완료!");
      
      // VAD 시작
      startVAD();
      
    } catch (error) {
      console.error("마이크 초기화 실패:", error);
    }
  };

  const cleanupMicAndVAD = () => {
    stopVAD();
    stopRecording();
    
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    setMicEnabled(false);
  };

  // ============================================
  // API 호출 함수
  // ============================================
  const callChatAPI = async (
    type: "greeting" | "game_explain" | "chat",
    options: {
      message?: string;
      history?: ChatMessage[];
      game?: string;
    } = {}
  ) => {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: type,
          message: options.message || '',
          history: options.history || [],
          game: options.game || '',
          userName: userNameRef.current,
          userStats: userStatsRef.current,
        }),
      });
      const data = await response.json();
      return data.reply;
    } catch (error) {
      console.error("Chat API error:", error);
      return "죄송합니다. 일시적인 오류가 발생했습니다.";
    }
  };

  const speakWithAvatar = async (text: string) => {
    console.log("=== Attempting to speak ===");
    console.log("Avatar ref exists:", !!avatarRef.current);
    console.log("Text to speak:", text);
    
    if (!avatarRef.current || !text) {
      console.log("Cannot speak - missing avatar or text");
      return;
    }
    
    try {
      console.log("Calling avatar.speak()...");
      await avatarRef.current.speak({
        text: text,
        taskType: TaskType.REPEAT,
      });
      console.log("Speak successful!");
    } catch (error) {
      console.error("Avatar speak error:", error);
    }
  };

  const handleUserSpeech = useMemoizedFn(async (transcript: string) => {
    if (!transcript.trim() || isProcessingRef.current) return;
    
    isProcessingRef.current = true;
    setIsLoading(true);
    
    console.log("User said:", transcript);
    
    const newHistory = [...chatHistory, { role: "user" as const, content: transcript }];
    setChatHistory(newHistory);
    
    const reply = await callChatAPI("chat", { 
      message: transcript, 
      history: chatHistory 
    });
    console.log("API reply:", reply);
    
    setChatHistory([...newHistory, { role: "assistant" as const, content: reply }]);
    
    await speakWithAvatar(reply);
    
    setIsLoading(false);
    isProcessingRef.current = false;
  });

  const startSession = useMemoizedFn(async () => {
    if (hasStartedRef.current) {
      console.log("Session already started, skipping...");
      return;
    }
    hasStartedRef.current = true;
    
    try {
      const newToken = await fetchAccessToken();
      const avatarInstance = initAvatar(newToken);

      avatarInstance.on(StreamingEvents.STREAM_READY, async (event) => {
        console.log(">>>>> Stream ready:", event.detail);
        
        if (!hasGreetedRef.current) {
          try {
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            console.log("🔧 인사말 요청 중...");
            console.log("🔧 현재 저장된 userName:", userNameRef.current);
            console.log("🔧 현재 저장된 stats:", userStatsRef.current);
            
            const greeting = await callChatAPI("greeting");
            console.log("🔧 생성된 인사말:", greeting);

            await new Promise<void>((resolve) => {
              const onStopTalking = () => {
                console.log("🎤 아바타 말 끝남!");
                avatarInstance.off(StreamingEvents.AVATAR_STOP_TALKING, onStopTalking);
                resolve();
              };
              avatarInstance.on(StreamingEvents.AVATAR_STOP_TALKING, onStopTalking);
              speakWithAvatar(greeting);
            });

            setChatHistory([{ role: "assistant", content: greeting }]);
            console.log("Greeting sent successfully!");

            // 🆕 마이크 + VAD 초기화 (인사 후)
            await initMicAndVAD();
            console.log("🎤 음성 인식 준비 완료! 말씀하시면 자동으로 인식합니다.");
            
            hasGreetedRef.current = true;
          } catch (error) {
            console.error("Error in greeting sequence:", error);
          }
        }
      });
      
      avatarInstance.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        console.log("Stream disconnected");
        cleanupMicAndVAD();
        hasGreetedRef.current = false;
        hasStartedRef.current = false;
      });

      // 🆕 아바타 말하기 시작/끝 감지
      avatarInstance.on(StreamingEvents.AVATAR_START_TALKING, () => {
        console.log("🗣️ 아바타 말하기 시작 - VAD 일시 중지");
        isAvatarTalkingRef.current = true;
      });

      avatarInstance.on(StreamingEvents.AVATAR_STOP_TALKING, () => {
        console.log("🔇 아바타 말하기 끝 - VAD 재개");
        isAvatarTalkingRef.current = false;
      });

      await startAvatar(config);
      
    } catch (error) {
      console.error("Error starting avatar session:", error);
      hasStartedRef.current = false;
    }
  });

  const handleSendMessage = useMemoizedFn(async () => {
    const textToSend = inputText.trim();
    if (!textToSend || !avatarRef.current || isLoading) return;

    setInputText("");
    setIsLoading(true);

    const newHistory = [...chatHistory, { role: "user" as const, content: textToSend }];
    setChatHistory(newHistory);

    const reply = await callChatAPI("chat", {
      message: textToSend,
      history: chatHistory
    });

    setChatHistory([...newHistory, { role: "assistant" as const, content: reply }]);

    await speakWithAvatar(reply);

    setIsLoading(false);
  });

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  useUnmount(() => {
    stopAvatar();
    cleanupMicAndVAD();
    hasGreetedRef.current = false;
    hasStartedRef.current = false;
  });

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data && event.data.type === 'RESET_AVATAR') {
        console.log('📥 아바타 리셋 신호 받음!');
        cleanupMicAndVAD();
        hasStartedRef.current = false;
        hasGreetedRef.current = false;
        userNameRef.current = '';
        userStatsRef.current = null;
        return;
      }
      
      if (event.data && event.data.type === 'START_AVATAR') {
        console.log('📥 게임에서 시작 신호 받음!');
        console.log('📥 받은 데이터:', event.data);
        console.log('📥 이름:', event.data.name);
        if (event.data.name) {
          userNameRef.current = event.data.name;
        }
        if (event.data.stats) {
          userStatsRef.current = event.data.stats;
          console.log('📥 stats 저장됨:', event.data.stats);
        }
        startSession();
      }
      
      if (event.data && event.data.type === 'EXPLAIN_GAME') {
        const game = event.data.game;
        console.log('📥 게임 설명 요청:', game);
        
        if (avatarRef.current) {
          const explanation = await callChatAPI("game_explain", { game: game });
          console.log('🔧 생성된 게임 설명:', explanation);
          speakWithAvatar(explanation);
        }
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => {
        mediaStream.current!.play();
      };
    }
  }, [mediaStream, stream]);

  return (
    <div className="w-full h-full flex flex-col">
      {sessionState === StreamingAvatarSessionState.CONNECTED && stream ? (
        <div className="flex-1 relative flex flex-col">
          <div className="relative flex-shrink-0">
            <video
              ref={mediaStream}
              autoPlay
              playsInline
              style={{ display: "block", width: "100%", height: "auto" }}
            />
            
            <button
              className="absolute top-2 right-2 w-7 h-7 bg-black/50 hover:bg-red-600 text-white rounded-full flex items-center justify-center text-xs transition-all"
              title="종료"
              onClick={() => stopAvatar()}
            >
              ✕
            </button>

            <div className="absolute bottom-2 left-2 flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${
                isRecording ? 'bg-red-500 animate-pulse' : 
                isLoading ? 'bg-yellow-500' : 
                micEnabled ? 'bg-green-500' : 'bg-gray-500'
              }`} />
              <span className="text-white text-xs bg-black/50 px-2 py-1 rounded">
                {isRecording ? '🎤 듣는 중...' : 
                 isLoading ? '응답 생성 중...' : 
                 micEnabled ? '말씀하세요' : '마이크 준비 중...'}
              </span>
            </div>
          </div>

          <div className="p-2 bg-zinc-800 border-t border-zinc-700">
            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 bg-zinc-700 text-white text-sm rounded-lg border border-zinc-600 focus:outline-none focus:border-purple-500 disabled:opacity-50"
                disabled={isLoading}
                placeholder="또는 텍스트로 질문하세요..."
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyPress={handleKeyPress}
              />
              <button
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-600 text-white text-sm rounded-lg transition-colors"
                disabled={isLoading || !inputText.trim()}
                onClick={() => handleSendMessage()}
              >
                {isLoading ? "..." : "전송"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-zinc-900">
          {sessionState === StreamingAvatarSessionState.CONNECTING ? (
            <div className="flex flex-col items-center gap-3 text-white">
              <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-lg">연결 중...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-white">
              <span className="text-lg">🎮 게임을 시작하면</span>
              <span className="text-lg">AI 도우미가 나타나요!</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function InteractiveAvatarWrapper() {
  return (
    <StreamingAvatarProvider basePath={process.env.NEXT_PUBLIC_BASE_API_URL}>
      <InteractiveAvatar />
    </StreamingAvatarProvider>
  );
}
