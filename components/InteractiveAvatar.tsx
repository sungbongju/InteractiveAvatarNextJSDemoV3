/**
 * ================================================
 * 🎯 InteractiveAvatar.tsx - 치매 예방 게임 AI 아바타
 * ================================================
 * 
 * ✅ HeyGen Voice Chat (Deepgram STT) 사용
 * ✅ Whisper 제거 → 교수님 방식으로 변경
 * 
 * 흐름:
 * 1. HeyGen Voice Chat이 음성을 텍스트로 변환
 * 2. USER_END_MESSAGE 이벤트로 transcript 받음
 * 3. route.ts로 전송 → DB 조회 + 응답 생성
 * 4. avatar.speak()로 응답
 * 
 * ================================================
 */

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

// ============================================
// 아바타 기본 설정 (교수님 코드와 동일)
// ============================================
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
  const mediaStream = useRef<HTMLVideoElement>(null);
  
  // ============================================
  // 🆕 직접 DB 조회 (route.ts 우회)
  // ============================================
  const DB_API_URL = "https://www.aiforalab.com/api.php";
  
  const fetchUserStats = async (playerName: string) => {
    try {
      const response = await fetch(`${DB_API_URL}?action=get_stats&player_name=${encodeURIComponent(playerName)}`);
      const data = await response.json();
      console.log("📊 DB 조회 결과:", data);
      return data;
    } catch (error) {
      console.error("DB 조회 실패:", error);
      return null;
    }
  };

  const generateResponse = (transcript: string, stats: any): string => {
    const lowerText = transcript.toLowerCase();
    
    // 점수 관련 질문
    if (lowerText.includes("점수") || lowerText.includes("기록")) {
      if (stats && stats.best_score > 0) {
        return `${userNameRef.current}님의 최고 점수는 ${stats.best_score}점이에요! 총 ${stats.total_games}번 플레이하셨네요.`;
      }
      return "아직 게임 기록이 없어요. 게임을 한 번 해보실래요?";
    }
    
    // 게임 추천
    if (lowerText.includes("추천") || lowerText.includes("어떤 게임")) {
      return "화투 짝맞추기나 속담 완성하기를 추천드려요! 기억력과 언어 능력 향상에 도움이 됩니다.";
    }
    
    // 기본 응답
    return "네, 궁금한 점이 있으시면 말씀해 주세요! 점수나 게임에 대해 물어보실 수 있어요.";
  };

  // 상태 관리 refs
  const isProcessingRef = useRef(false);
  const hasGreetedRef = useRef(false);
  const hasStartedRef = useRef(false);
  const userNameRef = useRef<string>('');
  const userStatsRef = useRef<any>(null);
  const lastTranscriptRef = useRef<string>('');  // 🆕 마지막 transcript 저장

  // ============================================
  // API 호출 함수들
  // ============================================
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

  // route.ts 호출 (DB 연동 + Function Calling)
  const callChatAPI = async (type: string, data?: any) => {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: type,
          userName: userNameRef.current,
          userStats: userStatsRef.current,
          ...data,
        }),
      });
      const result = await response.json();
      return result.reply || result.error || "응답을 생성하지 못했습니다.";
    } catch (error) {
      console.error("Chat API error:", error);
      return "죄송합니다. 일시적인 오류가 발생했습니다. 다시 말씀해 주세요.";
    }
  };

  // ============================================
  // 아바타 음성 출력
  // ============================================
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
        taskType: TaskType.REPEAT,  // 우리가 생성한 응답을 그대로 말함
      });
      console.log("Speak successful!");
    } catch (error) {
      console.error("Avatar speak error:", error);
    }
  };

  // ============================================
  // 🎯 핵심: HeyGen Voice Chat에서 받은 음성 처리
  // ============================================
  const handleUserSpeech = useMemoizedFn(async (transcript: string) => {
    if (!transcript.trim() || isProcessingRef.current) return;
    
    isProcessingRef.current = true;
    setIsLoading(true);
    
    console.log("🎯 User said:", transcript);
    
    // 🔥 HeyGen 내부 LLM 응답 즉시 차단!
    if (avatarRef.current) {
      try {
        console.log("🛑 HeyGen 자동 응답 차단 시도 (interrupt)...");
        await avatarRef.current.interrupt();
        console.log("🛑 HeyGen 자동 응답 차단 성공!");
      } catch (interruptError) {
        console.log("🛑 interrupt 실패 (무시):", interruptError);
      }
    }
    
    // 채팅 히스토리에 추가
    const newHistory = [...chatHistory, { role: "user" as const, content: transcript }];
    setChatHistory(newHistory);
    
    // route.ts로 전송 → DB 조회 + 응답 생성
    const reply = await callChatAPI("chat", { 
      message: transcript, 
      history: chatHistory 
    });
    console.log("🎯 API reply:", reply);
    
    // 응답을 히스토리에 추가
    setChatHistory([...newHistory, { role: "assistant" as const, content: reply }]);
    
    // 아바타가 응답 말하기
    await speakWithAvatar(reply);
    
    setIsLoading(false);
    isProcessingRef.current = false;
  });

  // ============================================
  // 아바타 세션 시작
  // ============================================
  const startSession = useMemoizedFn(async () => {
    if (hasStartedRef.current) {
      console.log("Session already started, skipping...");
      return;
    }
    hasStartedRef.current = true;
    
    try {
      const newToken = await fetchAccessToken();
      const avatarInstance = initAvatar(newToken);

      // 스트림 준비 완료
      avatarInstance.on(StreamingEvents.STREAM_READY, async (event) => {
        console.log(">>>>> Stream ready:", event.detail);
        
        if (!hasGreetedRef.current) {
          try {
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            console.log("🔧 인사말 생성 중...");
            console.log("🔧 현재 저장된 userName:", userNameRef.current);
            console.log("🔧 현재 저장된 stats:", userStatsRef.current);
            
            // 🆕 직접 인사말 생성 (route.ts 우회)
            let greeting: string;
            const stats = userStatsRef.current;
            const name = userNameRef.current || "손님";
            
            if (stats && stats.total_games && parseInt(stats.total_games) > 0) {
              greeting = `안녕하세요, ${name}님! 다시 만나서 반가워요. 이전에 ${stats.best_score}점을 기록하셨네요. 오늘도 즐거운 게임 되세요!`;
            } else {
              greeting = `안녕하세요, ${name}님! 저는 두뇌 게임 도우미예요. 게임 방법이 궁금하시면 물어봐 주세요!`;
            }
            
            console.log("🔧 생성된 인사말:", greeting);

            await speakWithAvatar(greeting);
            setChatHistory([{ role: "assistant", content: greeting }]);
            
            console.log("Greeting sent successfully!");
            hasGreetedRef.current = true;
          } catch (error) {
            console.error("Error in greeting sequence:", error);
          }
        }
      });
      
      // 스트림 연결 끊김
      avatarInstance.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        console.log("Stream disconnected");
        hasGreetedRef.current = false;
        hasStartedRef.current = false;
      });

      // 🎯 HeyGen Voice Chat 이벤트들
      avatarInstance.on(StreamingEvents.USER_START, () => {
        console.log("🎤 User started speaking");
        setIsListening(true);
      });

      avatarInstance.on(StreamingEvents.USER_STOP, () => {
        console.log("🎤 User stopped speaking");
        setIsListening(false);
      });

      // 🔧 디버깅: USER_TALKING_MESSAGE에서 transcript 저장
      avatarInstance.on(StreamingEvents.USER_TALKING_MESSAGE, (event) => {
        const message = event.detail?.message;
        console.log("🎤 USER_TALKING_MESSAGE:", message);
        if (message) {
          lastTranscriptRef.current = message;  // 마지막 transcript 저장
        }
      });

      // 🎯 핵심: USER_END_MESSAGE에서 저장된 transcript 처리
      avatarInstance.on(StreamingEvents.USER_END_MESSAGE, (event) => {
        console.log("🎤 USER_END_MESSAGE - 저장된 transcript:", lastTranscriptRef.current);
        
        const finalMessage = lastTranscriptRef.current;
        if (finalMessage && finalMessage.trim()) {
          handleUserSpeech(finalMessage);
        }
        
        // 처리 후 초기화
        lastTranscriptRef.current = '';
      });

      // 아바타 시작
      await startAvatar(config);

      // 🎯 Voice Chat 시작 (HeyGen Deepgram STT 사용)
      console.log("🎤 Voice Chat 시작 시도...");
      try {
        await avatarInstance.startVoiceChat({
          useSilencePrompt: false,
        });
        console.log("🎤 Voice Chat 시작 성공!");
      } catch (vcError) {
        console.error("🎤 Voice Chat 시작 실패:", vcError);
      }
      console.log("🎤 Voice chat started - using HeyGen STT + route.ts for responses");
      
    } catch (error) {
      console.error("Error starting avatar session:", error);
      hasStartedRef.current = false;
    }
  });

  // ============================================
  // 텍스트 메시지 전송
  // ============================================
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

  // ============================================
  // 게임 페이지와의 postMessage 통신
  // ============================================
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // 아바타 리셋
      if (event.data && event.data.type === 'RESET_AVATAR') {
        console.log('📥 아바타 리셋 신호 받음!');
        stopAvatar();  // 🔧 실제 세션 종료!
        hasStartedRef.current = false;
        hasGreetedRef.current = false;
        userNameRef.current = '';
        userStatsRef.current = null;
        return;
      }
      
      // 아바타 종료 (PIP X 버튼)
      if (event.data && event.data.type === 'STOP_AVATAR') {
        console.log('📥 아바타 종료 신호 받음!');
        stopAvatar();
        hasStartedRef.current = false;
        hasGreetedRef.current = false;
        userNameRef.current = '';
        userStatsRef.current = null;
        return;
      }
      
      // 아바타 시작 (게임 페이지에서 이름 입력 후)
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
      
      // 게임 설명 요청
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

  // 컴포넌트 언마운트 시 정리
  useUnmount(() => {
    stopAvatar();
  });

  // 비디오 스트림 연결
  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => {
        mediaStream.current!.play();
      };
    }
  }, [mediaStream, stream]);

  // ============================================
  // UI 렌더링
  // ============================================
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
            
            {/* 종료 버튼 */}
            <button
              className="absolute top-2 right-2 w-7 h-7 bg-black/50 hover:bg-red-600 text-white rounded-full flex items-center justify-center text-xs transition-all"
              title="종료"
              onClick={() => stopAvatar()}
            >
              ✕
            </button>

            {/* 음성 인식 상태 표시 */}
            <div className="absolute bottom-2 left-2 flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isListening ? 'bg-red-500 animate-pulse' : isLoading ? 'bg-yellow-500' : 'bg-green-500'}`} />
              <span className="text-white text-xs bg-black/50 px-2 py-1 rounded">
                {isListening ? '듣는 중...' : isLoading ? '응답 생성 중...' : '말씀하세요'}
              </span>
            </div>
          </div>

          {/* 텍스트 입력 */}
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
        <div className="w-full h-full flex items-center justify-center">
          {sessionState === StreamingAvatarSessionState.CONNECTING ? (
            <div className="flex flex-col items-center gap-3 text-white">
              <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">연결 중...</span>
            </div>
          ) : (
            <button
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-full text-base font-medium transition-all shadow-lg hover:shadow-xl"
              onClick={startSession}
            >
              🎮 게임 도우미 시작
            </button>
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
