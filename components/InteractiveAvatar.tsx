/**
 * ================================================
 * InteractiveAvatar.tsx - 치매 예방 게임 AI 아바타
 * ================================================
 *
 * 흐름:
 * 1. HeyGen Voice Chat (Deepgram STT) → 음성을 텍스트로 변환
 * 2. USER_TALKING_MESSAGE → transcript 저장
 * 3. USER_END_MESSAGE → route.ts 호출 → DB 조회 + 응답 생성
 * 4. avatar.speak(REPEAT) → 응답 출력
 *
 * 핵심: 아바타가 말할 때 마이크 뮤트 → 자기 목소리 인식 방지
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
import { useEffect, useRef, useState } from "react";
import { useMemoizedFn, useUnmount } from "ahooks";

import { useStreamingAvatarSession } from "./logic/useStreamingAvatarSession";
import { StreamingAvatarProvider, StreamingAvatarSessionState } from "./logic";
import { AVATARS } from "@/app/lib/constants";

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
  const mediaStream = useRef<HTMLVideoElement>(null);

  // 내부 상태 refs
  const isProcessingRef = useRef(false);
  const hasGreetedRef = useRef(false);
  const hasStartedRef = useRef(false);
  const userNameRef = useRef("");
  const userStatsRef = useRef<any>(null);
  const lastTranscriptRef = useRef("");

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
  // 아바타 음성 출력 (마이크 뮤트 포함)
  // ============================================
  const speakWithAvatar = async (text: string) => {
    if (!avatarRef.current || !text) return;

    try {
      // 🔇 말하기 전 마이크 뮤트
      console.log("🔇 마이크 뮤트");
      await avatarRef.current.muteInputAudio();
      setIsAvatarSpeaking(true);

      console.log("🗣️ Avatar speaking:", text);
      await avatarRef.current.speak({
        text,
        taskType: TaskType.REPEAT,
      });
    } catch (error) {
      console.error("Avatar speak error:", error);
      // 에러 시에도 뮤트 해제
      try {
        await avatarRef.current?.unmuteInputAudio();
      } catch {}
      setIsAvatarSpeaking(false);
    }
  };

  // ============================================
  // 사용자 음성 처리
  // ============================================
  const handleUserSpeech = useMemoizedFn(async (transcript: string) => {
    // 아바타가 말하는 중이면 무시
    if (isAvatarSpeaking) {
      console.log("⏸️ 아바타가 말하는 중 - 무시:", transcript);
      return;
    }

    if (!transcript.trim() || isProcessingRef.current) return;

    isProcessingRef.current = true;
    setIsLoading(true);
    console.log("🎯 User said:", transcript);

    // HeyGen 자동 응답 차단
    try {
      await avatarRef.current?.interrupt();
    } catch {}

    // 히스토리 업데이트
    const newHistory = [...chatHistory, { role: "user" as const, content: transcript }];
    setChatHistory(newHistory);

    // route.ts로 응답 생성
    const reply = await callChatAPI("chat", {
      message: transcript,
      history: chatHistory,
    });
    console.log("🎯 API reply:", reply);

    setChatHistory([...newHistory, { role: "assistant" as const, content: reply }]);

    // 아바타가 응답 말하기
    await speakWithAvatar(reply);

    setIsLoading(false);
    isProcessingRef.current = false;
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

      // 스트림 준비 완료 → 인사말
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
      });

      // 🔊 아바타 말하기 시작 → 마이크 뮤트 유지
      avatar.on(StreamingEvents.AVATAR_START_TALKING, () => {
        console.log("🗣️ Avatar started talking");
        setIsAvatarSpeaking(true);
      });

      // 🔈 아바타 말하기 끝 → 마이크 언뮤트
      avatar.on(StreamingEvents.AVATAR_STOP_TALKING, async () => {
        console.log("🔈 Avatar stopped talking - 마이크 언뮤트");
        setIsAvatarSpeaking(false);

        // 약간의 딜레이 후 마이크 언뮤트 (에코 방지)
        await new Promise((r) => setTimeout(r, 500));
        try {
          await avatarRef.current?.unmuteInputAudio();
          console.log("🎤 마이크 언뮤트 완료");
        } catch (e) {
          console.log("마이크 언뮤트 실패:", e);
        }
      });

      // 사용자 말하기 시작/끝 (UI용)
      avatar.on(StreamingEvents.USER_START, () => {
        if (!isAvatarSpeaking) {
          console.log("🎤 User started speaking");
          setIsListening(true);
        }
      });

      avatar.on(StreamingEvents.USER_STOP, () => {
        console.log("🎤 User stopped speaking");
        setIsListening(false);
      });

      // 실시간 transcript 저장
      avatar.on(StreamingEvents.USER_TALKING_MESSAGE, (event) => {
        if (isAvatarSpeaking) return; // 아바타가 말하는 중이면 무시

        const message = event.detail?.message;
        if (message) {
          console.log("🎤 Transcript:", message);
          lastTranscriptRef.current = message;
        }
      });

      // 사용자 말 끝 → 처리
      avatar.on(StreamingEvents.USER_END_MESSAGE, () => {
        if (isAvatarSpeaking) {
          console.log("⏸️ 아바타가 말하는 중 - USER_END_MESSAGE 무시");
          lastTranscriptRef.current = "";
          return;
        }

        const transcript = lastTranscriptRef.current;
        console.log("🎤 Final transcript:", transcript);

        if (transcript.trim()) {
          handleUserSpeech(transcript);
        }
        lastTranscriptRef.current = "";
      });

      // 아바타 시작
      await startAvatar(AVATAR_CONFIG);

      // Voice Chat 시작
      console.log("🎤 Starting Voice Chat...");
      await avatar.startVoiceChat();
      console.log("🎤 Voice Chat started");
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
  // postMessage 통신 (게임 페이지와)
  // ============================================
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const { type, name, stats, game } = event.data || {};

      switch (type) {
        case "RESET_AVATAR":
        case "STOP_AVATAR":
          console.log(`📥 ${type}`);
          stopAvatar();
          hasStartedRef.current = false;
          hasGreetedRef.current = false;
          userNameRef.current = "";
          userStatsRef.current = null;
          break;

        case "START_AVATAR":
          console.log("📥 START_AVATAR", { name, stats });
          if (name) userNameRef.current = name;
          if (stats) userStatsRef.current = stats;
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
  useUnmount(() => stopAvatar());

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
              onClick={() => stopAvatar()}
            >
              ✕
            </button>

            {/* 상태 표시 */}
            <div className="absolute bottom-2 left-2 flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
              <span className="text-white text-xs bg-black/50 px-2 py-1 rounded">
                {getStatusText()}
              </span>
            </div>
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
