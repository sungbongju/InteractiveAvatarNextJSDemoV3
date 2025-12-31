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
// 아바타 기본 설정
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
    provider: STTProvider.DEEPGRAM,  // HeyGen 내장 STT 사용
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
  
  // 상태 관리 refs
  const isProcessingRef = useRef(false);
  const hasGreetedRef = useRef(false);
  const hasStartedRef = useRef(false);
  const userNameRef = useRef<string>('');
  const userStatsRef = useRef<any>(null);

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
    
    console.log("User said:", transcript);
    
    // 채팅 히스토리에 추가
    const newHistory = [...chatHistory, { role: "user" as const, content: transcript }];
    setChatHistory(newHistory);
    
    // route.ts로 전송 → DB 조회 + 응답 생성
    const reply = await callChatAPI("chat", { 
      message: transcript, 
      history: chatHistory 
    });
    console.log("API reply:", reply);
    
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
            
            console.log("🔧 인사말 요청 중...");
            console.log("🔧 현재 저장된 userName:", userNameRef.current);
            console.log("🔧 현재 저장된 stats:", userStatsRef.current);
            
            // route.ts에서 맞춤 인사말 생성
            const greeting = await callChatAPI("greeting");
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

      // 🎯 핵심: 사용자 음성 transcript 받기
      avatarInstance.on(StreamingEvents.USER_END_MESSAGE, (event) => {
        const finalMessage = event.detail?.message;
        console.log("🎤 User final message:", finalMessage);
        if (finalMessage && finalMessage.trim()) {
          handleUserSpeech(finalMessage);
        }
      });

      // 아바타 시작
      await startAvatar(config);

      // 🎯 Voice Chat 시작 (HeyGen Deepgram STT 사용)
      await avatarInstance.startVoiceChat();
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
