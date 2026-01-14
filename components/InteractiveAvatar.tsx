/**
 * ================================================
 * InteractiveAvatar.tsx - 범용 AI 상담 아바타 (V3)
 * ================================================
 *
 * 쇼핑몰/고객센터 등 범용 상담용 아바타
 * - HeyGen Knowledge Base 연동
 * - Web Speech API (기존 webSpeechAPI.ts 사용)
 * - PIP 위젯 최적화 UI
 * - route.ts와 연동 가능 (DB 연결용)
 *
 * 설정:
 * - AVATAR_ID: labs.heygen.com/interactive-avatar에서 복사
 * - KNOWLEDGE_ID: labs.heygen.com에서 Knowledge Base 생성 후 ID
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

// ============================================
// 🔧 설정
// ============================================

// 아바타 ID (Wayne)
const AVATAR_ID = AVATARS[0]?.avatar_id || "Wayne_20240711";

// Knowledge Base ID (쇼핑몰 상담 데모)
const KNOWLEDGE_ID = "23c6bcc9f39046d9831d6a17137ec576";

// 시작 인사말
const GREETING_MESSAGE = "안녕하세요! AI 상담원 데모입니다. 무엇이든 물어보세요!";

// 아바타 설정
const AVATAR_CONFIG: StartAvatarRequest = {
  quality: AvatarQuality.Low,
  avatarName: AVATAR_ID,
  knowledgeId: KNOWLEDGE_ID || undefined,
  voice: {
    rate: 1.2,
    emotion: VoiceEmotion.FRIENDLY,
    model: ElevenLabsModel.eleven_flash_v2_5,
  },
  language: "ko",
};

// ============================================
// 메인 컴포넌트
// ============================================
function InteractiveAvatar() {
  const {
    initAvatar,
    startAvatar,
    stopAvatar,
    sessionState,
    stream,
    avatarRef,
  } = useStreamingAvatarSession();

  // UI 상태
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const mediaStream = useRef<HTMLVideoElement>(null);

  // 내부 상태 refs
  const isProcessingRef = useRef(false);
  const hasGreetedRef = useRef(false);
  const hasStartedRef = useRef(false);
  const webSpeechRef = useRef<WebSpeechRecognizer | null>(null);
  const isAvatarSpeakingRef = useRef(false);

  // ============================================
  // API 호출
  // ============================================
  const fetchAccessToken = async () => {
    const response = await fetch("/api/get-access-token", { method: "POST" });
    const token = await response.text();

    return token;
  };

  // route.ts 호출 (DB 연동용 - 나중에 확장 가능)
  const callChatAPI = async (type: string, data?: Record<string, unknown>) => {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
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
  // 아바타 음성 출력
  // ============================================
  const speakWithAvatar = useCallback(
    async (text: string) => {
      if (!avatarRef.current || !text) return;

      try {
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
        isAvatarSpeakingRef.current = false;
        setIsAvatarSpeaking(false);
        webSpeechRef.current?.resume();
      }
    },
    [avatarRef],
  );

  // ============================================
  // 사용자 음성 처리
  // ============================================
  const handleUserSpeech = useCallback(
    async (transcript: string) => {
      if (isAvatarSpeakingRef.current) {
        console.log("⏸️ 아바타가 말하는 중 - 무시:", transcript);

        return;
      }

      if (!transcript.trim() || isProcessingRef.current) return;

      isProcessingRef.current = true;
      setIsLoading(true);
      setInterimTranscript("");
      console.log("🎯 User said:", transcript);

      try {
        await avatarRef.current?.interrupt();
      } catch {
        // ignore
      }

      // Knowledge Base가 있으면 HeyGen이 자동 응답
      // 없거나 커스텀 로직 필요시 route.ts 호출
      if (!KNOWLEDGE_ID) {
        const reply = await callChatAPI("chat", { message: transcript });

        await speakWithAvatar(reply);
      }

      setIsLoading(false);
      isProcessingRef.current = false;
    },
    [avatarRef, speakWithAvatar],
  );

  // ============================================
  // Web Speech API 초기화 (기존 webSpeechAPI.ts 사용)
  // ============================================
  const initWebSpeech = useCallback(() => {
    if (webSpeechRef.current) {
      console.log("🎤 Web Speech 이미 초기화됨");

      return;
    }

    if (!WebSpeechRecognizer.isSupported()) {
      console.error("🎤 Web Speech API 지원하지 않는 브라우저");
      alert(
        "이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge를 사용해주세요.",
      );

      return;
    }

    console.log("🎤 Web Speech API 초기화 중...");

    webSpeechRef.current = new WebSpeechRecognizer(
      {
        onResult: (transcript: string, isFinal: boolean) => {
          if (isAvatarSpeakingRef.current) {
            return;
          }

          if (isFinal) {
            console.log("🎤 최종 인식:", transcript);
            setInterimTranscript("");
            handleUserSpeech(transcript);
          } else {
            setInterimTranscript(transcript);
          }
        },

        onStart: () => {
          if (!isAvatarSpeakingRef.current) {
            setIsListening(true);
          }
        },

        onEnd: () => {
          setIsListening(false);
        },

        onSpeechStart: () => {
          if (!isAvatarSpeakingRef.current) {
            setIsListening(true);
          }
        },

        onSpeechEnd: () => {
          setTimeout(() => {
            if (!isAvatarSpeakingRef.current) {
              setIsListening(false);
            }
          }, 500);
        },

        onError: (error: string) => {
          console.error("🎤 Web Speech 에러:", error);
          if (error === "not-allowed") {
            alert(
              "마이크 권한이 필요합니다. 브라우저 설정에서 마이크를 허용해주세요.",
            );
          }
        },
      },
      {
        lang: "ko-KR",
        continuous: true,
        interimResults: true,
        autoRestart: true,
      },
    );

    console.log("🎤 Web Speech API 초기화 완료");
  }, [handleUserSpeech]);

  // ============================================
  // 세션 초기화
  // ============================================
  const resetSession = useMemoizedFn(async () => {
    console.log("🔄 세션 초기화 중...");

    if (webSpeechRef.current) {
      webSpeechRef.current.destroy();
      webSpeechRef.current = null;
    }

    try {
      await stopAvatar();
    } catch (e) {
      console.log("stopAvatar 에러 (무시):", e);
    }

    hasStartedRef.current = false;
    hasGreetedRef.current = false;
    isProcessingRef.current = false;
    isAvatarSpeakingRef.current = false;
    setIsLoading(false);
    setIsListening(false);
    setIsAvatarSpeaking(false);
    setInterimTranscript("");

    await new Promise((r) => setTimeout(r, 500));
    console.log("🔄 세션 초기화 완료");
  });

  // ============================================
  // 세션 시작
  // ============================================
  const startSession = useMemoizedFn(async () => {
    if (hasStartedRef.current) {
      console.log("⚠️ 이미 세션 시작됨, 무시");

      return;
    }
    hasStartedRef.current = true;

    try {
      const token = await fetchAccessToken();
      const avatar = initAvatar(token);

      avatar.on(StreamingEvents.STREAM_READY, async () => {
        console.log("✅ Stream ready");

        if (!hasGreetedRef.current) {
          await new Promise((r) => setTimeout(r, 1500));
          await speakWithAvatar(GREETING_MESSAGE);
          hasGreetedRef.current = true;
        }
      });

      avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        console.log("❌ Stream disconnected");
        hasGreetedRef.current = false;
        hasStartedRef.current = false;
        webSpeechRef.current?.destroy();
        webSpeechRef.current = null;
      });

      avatar.on(StreamingEvents.AVATAR_START_TALKING, () => {
        console.log("🗣️ Avatar started talking - Web Speech 일시정지");
        isAvatarSpeakingRef.current = true;
        setIsAvatarSpeaking(true);
        webSpeechRef.current?.pause();
      });

      avatar.on(StreamingEvents.AVATAR_STOP_TALKING, async () => {
        console.log("🔈 Avatar stopped talking - Web Speech 재개");
        isAvatarSpeakingRef.current = false;
        setIsAvatarSpeaking(false);
        await new Promise((r) => setTimeout(r, 500));
        webSpeechRef.current?.resume();
        console.log("🎤 Web Speech 재개 완료");
      });

      await startAvatar(AVATAR_CONFIG);

      console.log("🎤 Web Speech API 시작...");
      initWebSpeech();

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
  // 마이크 토글
  // ============================================
  const toggleMicrophone = useCallback(() => {
    if (!webSpeechRef.current) {
      initWebSpeech();
      setTimeout(() => {
        webSpeechRef.current?.start();
      }, 100);

      return;
    }

    if (webSpeechRef.current.getIsPaused()) {
      webSpeechRef.current.resume();
    } else {
      webSpeechRef.current.pause();
    }
  }, [initWebSpeech]);

  // ============================================
  // postMessage 통신 (외부 페이지 연동용)
  // ============================================
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const { type } = event.data || {};

      switch (type) {
        case "RESET_AVATAR":
        case "STOP_AVATAR":
          console.log(`📥 ${type}`);
          await resetSession();
          break;

        case "START_AVATAR":
          console.log("📥 START_AVATAR");
          await resetSession();
          startSession();
          break;
      }
    };

    window.addEventListener("message", handleMessage);

    return () => window.removeEventListener("message", handleMessage);
  }, [resetSession, startSession]);

  // 언마운트 시 정리
  useUnmount(() => {
    webSpeechRef.current?.destroy();

    try {
      stopAvatar();
    } catch {
      // ignore
    }
  });

  // 비디오 스트림 연결
  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => mediaStream.current?.play();
    }
  }, [stream]);

  // ============================================
  // UI 헬퍼
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

  // ============================================
  // 렌더링 - PIP 최적화 UI
  // ============================================
  return (
    <div className="w-full h-full flex flex-col bg-black">
      {sessionState === StreamingAvatarSessionState.CONNECTED && stream ? (
        <div className="flex-1 relative">
          {/* 아바타 비디오 */}
          <video
            ref={mediaStream}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />

          {/* 종료 버튼 */}
          <button
            className="absolute top-2 right-2 w-8 h-8 bg-black/50 hover:bg-red-600 text-white rounded-full flex items-center justify-center text-sm transition-colors"
            onClick={resetSession}
            title="종료"
          >
            ✕
          </button>

          {/* 마이크 토글 버튼 */}
          <button
            className={`absolute top-2 left-2 w-8 h-8 ${
              isListening
                ? "bg-red-500 animate-pulse"
                : "bg-black/50 hover:bg-green-600"
            } text-white rounded-full flex items-center justify-center text-sm transition-colors`}
            disabled={isAvatarSpeaking}
            onClick={toggleMicrophone}
            title={isListening ? "마이크 끄기" : "마이크 켜기"}
          >
            {isListening ? "🎤" : "🎙️"}
          </button>

          {/* 상태 표시 */}
          <div className="absolute bottom-2 left-2 flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
            <span className="text-white text-xs bg-black/60 px-2 py-1 rounded">
              {getStatusText()}
            </span>
          </div>

          {/* 중간 인식 결과 표시 */}
          {interimTranscript && (
            <div className="absolute bottom-12 left-2 right-2">
              <div className="bg-black/70 text-white text-xs px-3 py-2 rounded-lg">
                🎤 &quot;{interimTranscript}&quot;
              </div>
            </div>
          )}
        </div>
      ) : (
        /* 시작 화면 */
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-900 to-black">
          {sessionState === StreamingAvatarSessionState.CONNECTING ? (
            <div className="flex flex-col items-center gap-3 text-white">
              <div className="w-10 h-10 border-3 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">연결 중...</span>
            </div>
          ) : (
            <button
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-full text-base font-medium shadow-lg transition-colors flex items-center gap-2"
              onClick={startSession}
            >
              <span>💬</span>
              <span>상담 시작</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// Provider Wrapper
// ============================================
export default function InteractiveAvatarWrapper() {
  return (
    <StreamingAvatarProvider basePath={process.env.NEXT_PUBLIC_BASE_API_URL}>
      <InteractiveAvatar />
    </StreamingAvatarProvider>
  );
}
