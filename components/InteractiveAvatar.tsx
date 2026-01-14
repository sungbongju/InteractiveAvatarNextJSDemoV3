/**
 * ================================================
 * InteractiveAvatar.tsx - 범용 AI 상담 아바타 (V3)
 * ================================================
 *
 * 쇼핑몰/고객센터 등 범용 상담용 아바타
 * - HeyGen Knowledge Base 연동
 * - Web Speech API (브라우저 내장, 무료)
 * - PIP 위젯 최적화 UI
 *
 * 설정 방법:
 * 1. AVATAR_ID: labs.heygen.com/interactive-avatar에서 복사
 * 2. KNOWLEDGE_ID: labs.heygen.com에서 Knowledge Base 생성 후 ID 복사
 * 3. .env에 HEYGEN_API_KEY 설정
 * ================================================
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

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

// ============================================
// 🔧 설정 - 여기서 아바타/Knowledge Base 설정
// ============================================

// 아바타 ID (Wayne)
const AVATAR_ID = "Wayne_20240711";

// Knowledge Base ID (쇼핑몰 상담 데모)
const KNOWLEDGE_ID = "23c6bcc9f39046d9831d6a17137ec576";

// 시작 인사말 (Knowledge Base의 Opening Intro와 맞춤)
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
// Web Speech API 헬퍼
// ============================================
interface WebSpeechCallbacks {
  onResult: (transcript: string, isFinal: boolean) => void;
  onStart: () => void;
  onEnd: () => void;
  onError: (error: string) => void;
}

class SimpleWebSpeech {
  private recognition: any = null;
  private isRunning = false;
  private isPaused = false;

  constructor(private callbacks: WebSpeechCallbacks) {
    if (typeof window !== "undefined") {
      const SpeechRecognitionAPI =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognitionAPI) {
        this.recognition = new SpeechRecognitionAPI();
        this.recognition.lang = "ko-KR";
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.setupListeners();
      }
    }
  }

  static isSupported(): boolean {
    if (typeof window === "undefined") return false;

    return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  private setupListeners() {
    if (!this.recognition) return;

    this.recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const transcript = result[0].transcript;
      this.callbacks.onResult(transcript, result.isFinal);
    };

    this.recognition.onstart = () => {
      this.isRunning = true;
      this.callbacks.onStart();
    };

    this.recognition.onend = () => {
      this.isRunning = false;
      this.callbacks.onEnd();
      // 자동 재시작 (일시정지 상태가 아닐 때)
      if (!this.isPaused) {
        setTimeout(() => this.start(), 100);
      }
    };

    this.recognition.onerror = (event) => {
      this.callbacks.onError(event.error);
    };
  }

  start() {
    if (this.recognition && !this.isRunning && !this.isPaused) {
      try {
        this.recognition.start();
      } catch (e) {
        console.log("Speech recognition start error:", e);
      }
    }
  }

  stop() {
    this.isPaused = true;
    if (this.recognition && this.isRunning) {
      this.recognition.stop();
    }
  }

  pause() {
    this.isPaused = true;
    if (this.recognition && this.isRunning) {
      this.recognition.stop();
    }
  }

  resume() {
    this.isPaused = false;
    this.start();
  }

  destroy() {
    this.stop();
    this.recognition = null;
  }

  getIsPaused() {
    return this.isPaused;
  }
}

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
  const webSpeechRef = useRef<SimpleWebSpeech | null>(null);
  const isAvatarSpeakingRef = useRef(false);

  // ============================================
  // API 호출
  // ============================================
  const fetchAccessToken = async () => {
    const response = await fetch("/api/get-access-token", { method: "POST" });
    const token = await response.text();
    return token;
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
    [avatarRef]
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
        // HeyGen interrupt - 이전 응답 중단
        await avatarRef.current?.interrupt();
      } catch {
        // ignore
      }

      // Knowledge Base가 설정되어 있으면 HeyGen이 자동 응답
      // 설정되어 있지 않으면 여기서 커스텀 로직 추가 가능
      if (!KNOWLEDGE_ID) {
        // TODO: 커스텀 응답 로직 (예: OpenAI API 호출)
        const reply = `"${transcript}"에 대한 답변입니다. Knowledge Base를 설정하시면 자동 응답이 가능합니다.`;
        await speakWithAvatar(reply);
      }
      // Knowledge Base가 있으면 HeyGen STT가 자동으로 응답 생성

      setIsLoading(false);
      isProcessingRef.current = false;
    },
    [avatarRef, speakWithAvatar]
  );

  // ============================================
  // Web Speech API 초기화
  // ============================================
  const initWebSpeech = useCallback(() => {
    if (webSpeechRef.current) return;

    if (!SimpleWebSpeech.isSupported()) {
      console.error("🎤 Web Speech API 미지원 브라우저");
      alert("이 브라우저는 음성 인식을 지원하지 않습니다. Chrome을 사용해주세요.");
      return;
    }

    webSpeechRef.current = new SimpleWebSpeech({
      onResult: (transcript, isFinal) => {
        if (isAvatarSpeakingRef.current) return;

        if (isFinal) {
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
      onError: (error) => {
        console.error("🎤 Web Speech 에러:", error);
        if (error === "not-allowed") {
          alert("마이크 권한이 필요합니다.");
        }
      },
    });

    console.log("🎤 Web Speech API 초기화 완료");
  }, [handleUserSpeech]);

  // ============================================
  // 세션 초기화
  // ============================================
  const resetSession = useMemoizedFn(async () => {
    console.log("🔄 세션 초기화...");

    webSpeechRef.current?.destroy();
    webSpeechRef.current = null;

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
  });

  // ============================================
  // 세션 시작
  // ============================================
  const startSession = useMemoizedFn(async () => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    try {
      const token = await fetchAccessToken();
      const avatar = initAvatar(token);

      // 스트림 준비 완료
      avatar.on(StreamingEvents.STREAM_READY, async () => {
        console.log("✅ Stream ready");

        if (!hasGreetedRef.current) {
          await new Promise((r) => setTimeout(r, 1500));
          await speakWithAvatar(GREETING_MESSAGE);
          hasGreetedRef.current = true;
        }
      });

      // 연결 해제
      avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        console.log("❌ Stream disconnected");
        hasGreetedRef.current = false;
        hasStartedRef.current = false;
        webSpeechRef.current?.destroy();
        webSpeechRef.current = null;
      });

      // 아바타 말하기 시작
      avatar.on(StreamingEvents.AVATAR_START_TALKING, () => {
        console.log("🗣️ Avatar started talking");
        isAvatarSpeakingRef.current = true;
        setIsAvatarSpeaking(true);
        webSpeechRef.current?.pause();
      });

      // 아바타 말하기 종료
      avatar.on(StreamingEvents.AVATAR_STOP_TALKING, async () => {
        console.log("🔈 Avatar stopped talking");
        isAvatarSpeakingRef.current = false;
        setIsAvatarSpeaking(false);
        await new Promise((r) => setTimeout(r, 500));
        webSpeechRef.current?.resume();
      });

      await startAvatar(AVATAR_CONFIG);

      // Web Speech 시작
      initWebSpeech();
      setTimeout(() => {
        webSpeechRef.current?.start();
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
      setTimeout(() => webSpeechRef.current?.start(), 100);
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
          await resetSession();
          break;

        case "START_AVATAR":
          await resetSession();
          startSession();
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [resetSession, startSession]);

  // 언마운트 정리
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
          {/* 아바타 비디오 - 전체 영역 */}
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
            onClick={toggleMicrophone}
            disabled={isAvatarSpeaking}
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
