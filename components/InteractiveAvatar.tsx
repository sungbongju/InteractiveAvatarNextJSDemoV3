/**
 * ================================================
 * InteractiveAvatar.tsx - 치매 예방 게임 AI 아바타
 * ================================================
 *
 * 🆕 변경사항: HeyGen STT → Web Speech API (브라우저 내장, 무료)
 * 
 * 흐름:
 * 1. Web Speech API → 음성을 텍스트로 변환 (무료!)
 * 2. 최종 인식 결과 → route.ts 호출 → DB 조회 + 응답 생성
 * 3. avatar.interrupt() → HeyGen 자동 응답 차단 (유지)
 * 4. avatar.speak(REPEAT) → 응답 출력
 *
 * 핵심: 아바타가 말할 때 Web Speech 일시정지 → 자기 목소리 인식 방지
 * ================================================
 */

import {
  AvatarQuality,
  StreamingEvents,
  VoiceEmotion,
  StartAvatarRequest,
  ElevenLabsModel,
  TaskType,
} from "@heygen/streaming-avatar";
import { useEffect, useRef, useState, useCallback } from "react";
import { useMemoizedFn, useUnmount } from "ahooks";

import { useStreamingAvatarSession } from "./logic/useStreamingAvatarSession";
import { StreamingAvatarProvider, StreamingAvatarSessionState } from "./logic";
import { AVATARS } from "@/app/lib/constants";
import { WebSpeechRecognizer } from "@/app/lib/webSpeechAPI";

// 아바타 설정
const AVATAR_CONFIG: StartAvatarRequest = {
  quality: AvatarQuality.Low,
  avatarName: AVATARS[0].avatar_id,
  voice: {
    rate: 1.5,
    emotion: VoiceEmotion.EXCITED,
    model: ElevenLabsModel.eleven_flash_v2_5,
  },
  language: "ko",
};

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function InteractiveAvatar() {
  const { initAvatar, startAvatar, stopAvatar, sessionState, stream, avatarRef } =
    useStreamingAvatarSession();

  // UI 상태
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState(""); // 🆕 중간 인식 결과
  const mediaStream = useRef<HTMLVideoElement>(null);

  // 내부 상태 refs
  const isProcessingRef = useRef(false);
  const hasGreetedRef = useRef(false);
  const hasStartedRef = useRef(false);
  const userNameRef = useRef("");
  const userStatsRef = useRef<any>(null);
  
  // 🆕 Web Speech API ref
  const webSpeechRef = useRef<WebSpeechRecognizer | null>(null);
  const isAvatarSpeakingRef = useRef(false); // 실시간 참조용

  // ============================================
  // 🔧 세션 완전 초기화 함수
  // ============================================
  const resetSession = useMemoizedFn(async () => {
    console.log("🔄 세션 초기화 중...");
    
    // 🆕 Web Speech 정리
    if (webSpeechRef.current) {
      webSpeechRef.current.destroy();
      webSpeechRef.current = null;
    }

    // 에러 무시하고 stopAvatar 시도
    try {
      await stopAvatar();
    } catch (e) {
      console.log("stopAvatar 에러 (무시):", e);
    }

    // 모든 상태 초기화
    hasStartedRef.current = false;
    hasGreetedRef.current = false;
    isProcessingRef.current = false;
    isAvatarSpeakingRef.current = false;
    userNameRef.current = "";
    userStatsRef.current = null;
    setChatHistory([]);
    setIsLoading(false);
    setIsListening(false);
    setIsAvatarSpeaking(false);
    setInterimTranscript("");

    // 약간의 딜레이 (세션 정리 시간)
    await new Promise((r) => setTimeout(r, 500));
    console.log("🔄 세션 초기화 완료");
  });

  // ============================================
  // API 호출
  // ============================================
  const fetchAccessToken = async () => {
    const response = await fetch("/api/get-access-token", { method: "POST" });
    const token = await response.text();
    console.log("Access Token:", token);
    return token;
  };

  const callChatAPI = async (type: string, data?: any) => {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          userName: userNameRef.current,
          userStats: userStatsRef.current,
          ...data,
        }),
      });
      const result = await response.json();
      return result.reply || result.error || "응답을 생성하지 못했습니다.";
    } catch (error) {
      console.error("Chat API error:", error);
      return "죄송합니다. 오류가 발생했습니다.";
    }
  };

  // ============================================
  // 아바타 음성 출력 (Web Speech 일시정지 포함)
  // ============================================
  const speakWithAvatar = async (text: string) => {
    if (!avatarRef.current || !text) return;

    try {
      // 🆕 말하기 전 Web Speech 일시정지
      console.log("🔇 Web Speech 일시정지");
      isAvatarSpeakingRef.current = true;
      setIsAvatarSpeaking(true);
      webSpeechRef.current?.pause();

      console.log("🗣️ Avatar speaking:", text);
      await avatarRef.current.speak({
        text,
        taskType: TaskType.REPEAT,
      });
    } catch (error) {
      console.error("Avatar speak error:", error);
      // 에러 시에도 Web Speech 재개
      isAvatarSpeakingRef.current = false;
      setIsAvatarSpeaking(false);
      webSpeechRef.current?.resume();
    }
  };

  // ============================================
  // 🆕 사용자 음성 처리 (Web Speech API용)
  // ============================================
  const handleUserSpeech = useCallback(async (transcript: string) => {
    // 아바타가 말하는 중이면 무시
    if (isAvatarSpeakingRef.current) {
      console.log("⏸️ 아바타가 말하는 중 - 무시:", transcript);
      return;
    }

    if (!transcript.trim() || isProcessingRef.current) return;

    isProcessingRef.current = true;
    setIsLoading(true);
    setInterimTranscript(""); // 중간 결과 클리어
    console.log("🎯 User said:", transcript);

    // 🔧 HeyGen 자동 응답 차단 (여전히 필요)
    try {
      await avatarRef.current?.interrupt();
    } catch {}

    // 히스토리 업데이트
    setChatHistory((prev) => {
      const newHistory = [...prev, { role: "user" as const, content: transcript }];
      
      // route.ts로 응답 생성
      callChatAPI("chat", {
        message: transcript,
        history: prev,
      }).then((reply) => {
        console.log("🎯 API reply:", reply);
        setChatHistory((current) => [...current, { role: "assistant" as const, content: reply }]);
        
        // 아바타가 응답 말하기
        speakWithAvatar(reply);
        
        setIsLoading(false);
        isProcessingRef.current = false;
      });

      return newHistory;
    });
  }, []);

  // ============================================
  // 🆕 Web Speech API 초기화
  // ============================================
  const initWebSpeech = useCallback(() => {
    // 이미 초기화되어 있으면 스킵
    if (webSpeechRef.current) {
      console.log("🎤 Web Speech 이미 초기화됨");
      return;
    }

    // 지원 여부 확인
    if (!WebSpeechRecognizer.isSupported()) {
      console.error("🎤 Web Speech API 지원하지 않는 브라우저");
      alert("이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge를 사용해주세요.");
      return;
    }

    console.log("🎤 Web Speech API 초기화 중...");

    webSpeechRef.current = new WebSpeechRecognizer(
      {
        // 🎤 음성 인식 결과
        onResult: (transcript: string, isFinal: boolean) => {
          if (isAvatarSpeakingRef.current) {
            // 아바타가 말하는 중이면 무시
            return;
          }

          if (isFinal) {
            // 최종 결과 → API 호출
            console.log("🎤 최종 인식:", transcript);
            setInterimTranscript("");
            handleUserSpeech(transcript);
          } else {
            // 중간 결과 → UI에 표시
            setInterimTranscript(transcript);
          }
        },

        // 🎤 인식 시작
        onStart: () => {
          if (!isAvatarSpeakingRef.current) {
            setIsListening(true);
          }
        },

        // 🎤 인식 종료
        onEnd: () => {
          setIsListening(false);
        },

        // 🎤 음성 감지 시작
        onSpeechStart: () => {
          if (!isAvatarSpeakingRef.current) {
            setIsListening(true);
          }
        },

        // 🎤 음성 감지 종료
        onSpeechEnd: () => {
          // 잠시 후 리스닝 상태 해제 (최종 결과 기다림)
          setTimeout(() => {
            if (!isAvatarSpeakingRef.current) {
              setIsListening(false);
            }
          }, 500);
        },

        // 🎤 에러
        onError: (error: string) => {
          console.error("🎤 Web Speech 에러:", error);
          // 마이크 권한 에러
          if (error === "not-allowed") {
            alert("마이크 권한이 필요합니다. 브라우저 설정에서 마이크를 허용해주세요.");
          }
        },
      },
      {
        lang: "ko-KR",       // 한국어
        continuous: true,    // 연속 인식
        interimResults: true, // 중간 결과
        autoRestart: true,   // 자동 재시작
      }
    );

    console.log("🎤 Web Speech API 초기화 완료");
  }, [handleUserSpeech]);

  // ============================================
  // 세션 시작
  // ============================================
  const startSession = useMemoizedFn(async () => {
    // 🔧 이미 시작 중이면 무시
    if (hasStartedRef.current) {
      console.log("⚠️ 이미 세션 시작됨, 무시");
      return;
    }
    hasStartedRef.current = true;

    try {
      const token = await fetchAccessToken();
      const avatar = initAvatar(token);

      // 스트림 준비 완료 → 인사말 + Web Speech 시작
      avatar.on(StreamingEvents.STREAM_READY, async (event) => {
        console.log("Stream ready:", event.detail);

        if (!hasGreetedRef.current) {
          await new Promise((r) => setTimeout(r, 1500));

          const name = userNameRef.current || "손님";
          const stats = userStatsRef.current;
          const greeting =
            stats && stats.total_games && parseInt(stats.total_games) > 0
              ? `안녕하세요, ${name}님! 다시 만나서 반가워요. 최고 점수 ${stats.best_score}점이네요!`
              : `안녕하세요, ${name}님! 저는 두뇌 게임 도우미예요.`;

          console.log("👋 인사말:", greeting);
          await speakWithAvatar(greeting);
          setChatHistory([{ role: "assistant", content: greeting }]);
          hasGreetedRef.current = true;
        }
      });

      // 연결 끊김
      avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        console.log("Stream disconnected");
        hasGreetedRef.current = false;
        hasStartedRef.current = false;
        
        // Web Speech 정리
        webSpeechRef.current?.destroy();
        webSpeechRef.current = null;
      });

      // 🔊 아바타 말하기 시작 → Web Speech 일시정지
      avatar.on(StreamingEvents.AVATAR_START_TALKING, () => {
        console.log("🗣️ Avatar started talking - Web Speech 일시정지");
        isAvatarSpeakingRef.current = true;
        setIsAvatarSpeaking(true);
        webSpeechRef.current?.pause();
      });

      // 🔈 아바타 말하기 끝 → Web Speech 재개
      avatar.on(StreamingEvents.AVATAR_STOP_TALKING, async () => {
        console.log("🔈 Avatar stopped talking - Web Speech 재개");
        isAvatarSpeakingRef.current = false;
        setIsAvatarSpeaking(false);

        // 약간의 딜레이 후 Web Speech 재개 (에코 방지)
        await new Promise((r) => setTimeout(r, 500));
        webSpeechRef.current?.resume();
        console.log("🎤 Web Speech 재개 완료");
      });

      // 아바타 시작
      await startAvatar(AVATAR_CONFIG);

      // 🆕 HeyGen Voice Chat 대신 Web Speech API 시작
      console.log("🎤 Web Speech API 시작...");
      initWebSpeech();
      
      // 약간의 딜레이 후 시작 (아바타 인사말 대기)
      setTimeout(() => {
        webSpeechRef.current?.start();
        console.log("🎤 Web Speech 인식 시작");
      }, 2000);

    } catch (error) {
      console.error("Session error:", error);
      hasStartedRef.current = false;
    }
  });

  // ============================================
  // 텍스트 메시지 전송
  // ============================================
  const handleSendMessage = useMemoizedFn(async () => {
    const text = inputText.trim();
    if (!text || !avatarRef.current || isLoading) return;

    setInputText("");
    setIsLoading(true);

    const newHistory = [...chatHistory, { role: "user" as const, content: text }];
    setChatHistory(newHistory);

    const reply = await callChatAPI("chat", { message: text, history: chatHistory });
    setChatHistory([...newHistory, { role: "assistant" as const, content: reply }]);

    await speakWithAvatar(reply);
    setIsLoading(false);
  });

  // ============================================
  // 🆕 마이크 토글 버튼 핸들러
  // ============================================
  const toggleMicrophone = useCallback(() => {
    if (!webSpeechRef.current) {
      initWebSpeech();
      webSpeechRef.current?.start();
      return;
    }

    if (webSpeechRef.current.getIsPaused()) {
      webSpeechRef.current.resume();
    } else {
      webSpeechRef.current.pause();
    }
  }, [initWebSpeech]);

  // ============================================
  // postMessage 통신 (게임 페이지와)
  // ============================================
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const { type, name, stats, game } = event.data || {};

      switch (type) {
        case "RESET_AVATAR":
        case "STOP_AVATAR":
          console.log(`📥 ${type}`);
          await resetSession();
          break;

        case "START_AVATAR":
          console.log("📥 START_AVATAR", { name, stats });
          
          // 🔧 핵심: 먼저 기존 세션 완전 정리 후 새로 시작
          await resetSession();
          
          // 새 사용자 정보 설정
          if (name) userNameRef.current = name;
          if (stats) userStatsRef.current = stats;
          
          // 새 세션 시작
          startSession();
          break;

        case "EXPLAIN_GAME":
          console.log("📥 EXPLAIN_GAME:", game);
          if (avatarRef.current && game) {
            const explanation = await callChatAPI("game_explain", { game });
            speakWithAvatar(explanation);
          }
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // 언마운트 시 정리
  useUnmount(() => {
    // Web Speech 정리
    webSpeechRef.current?.destroy();
    
    try {
      stopAvatar();
    } catch {}
  });

  // 비디오 스트림 연결
  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => mediaStream.current?.play();
    }
  }, [stream]);

  // ============================================
  // UI
  // ============================================
  const getStatusText = () => {
    if (isAvatarSpeaking) return "말하는 중...";
    if (isListening) return "듣는 중...";
    if (isLoading) return "생각 중...";
    return "말씀하세요";
  };

  const getStatusColor = () => {
    if (isAvatarSpeaking) return "bg-blue-500";
    if (isListening) return "bg-red-500 animate-pulse";
    if (isLoading) return "bg-yellow-500";
    return "bg-green-500";
  };

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
              className="absolute top-2 right-2 w-7 h-7 bg-black/50 hover:bg-red-600 text-white rounded-full flex items-center justify-center text-xs"
              onClick={() => resetSession()}
            >
              ✕
            </button>

            {/* 🆕 마이크 토글 버튼 */}
            <button
              className={`absolute top-2 left-2 w-7 h-7 ${
                isListening ? "bg-red-500 animate-pulse" : "bg-black/50 hover:bg-green-600"
              } text-white rounded-full flex items-center justify-center text-sm`}
              onClick={toggleMicrophone}
              disabled={isAvatarSpeaking}
              title={isListening ? "마이크 끄기" : "마이크 켜기"}
            >
              {isListening ? "🎤" : "🎙️"}
            </button>

            {/* 상태 표시 */}
            <div className="absolute bottom-2 left-2 flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
              <span className="text-white text-xs bg-black/50 px-2 py-1 rounded">
                {getStatusText()}
              </span>
            </div>

            {/* 🆕 중간 인식 결과 표시 */}
            {interimTranscript && (
              <div className="absolute bottom-10 left-2 right-2">
                <div className="bg-black/70 text-white text-xs px-2 py-1 rounded">
                  🎤 "{interimTranscript}"
                </div>
              </div>
            )}
          </div>

          {/* 텍스트 입력 */}
          <div className="p-2 bg-zinc-800 border-t border-zinc-700">
            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 bg-zinc-700 text-white text-sm rounded-lg border border-zinc-600 focus:outline-none focus:border-purple-500 disabled:opacity-50"
                disabled={isLoading || isAvatarSpeaking}
                placeholder="텍스트로 질문하세요..."
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
              />
              <button
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-600 text-white text-sm rounded-lg"
                disabled={isLoading || isAvatarSpeaking || !inputText.trim()}
                onClick={handleSendMessage}
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
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-full text-base font-medium shadow-lg"
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
