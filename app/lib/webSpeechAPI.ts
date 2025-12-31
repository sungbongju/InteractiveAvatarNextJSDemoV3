/**
 * ================================================
 * webSpeechAPI.ts - Web Speech API 래퍼 클래스
 * ================================================
 * 
 * HeyGen STT 대신 브라우저 내장 Web Speech API 사용
 * - 무료 (브라우저 내장)
 * - 한국어 지원 (ko-KR)
 * - Chrome, Edge, Safari 등 지원
 * 
 * 참고: D-ID agents-sdk-demo/webSpeechAPI.js
 * 경로: app/lib/webSpeechAPI.ts
 * ================================================
 */

// Web Speech API 타입 정의 (브라우저 내장이라 별도 설치 불필요)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

// SpeechRecognition 인터페이스
interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  
  start(): void;
  stop(): void;
  abort(): void;
  
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onaudiostart: (() => void) | null;
  onaudioend: (() => void) | null;
}

// Window 확장
declare global {
  interface Window {
    SpeechRecognition: new () => ISpeechRecognition;
    webkitSpeechRecognition: new () => ISpeechRecognition;
  }
}

// 콜백 타입
export interface WebSpeechCallbacks {
  onResult: (transcript: string, isFinal: boolean) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
}

// 설정 타입
export interface WebSpeechConfig {
  lang?: string;           // 언어 (기본: 'ko-KR')
  continuous?: boolean;    // 연속 인식 (기본: true)
  interimResults?: boolean; // 중간 결과 (기본: true)
  maxAlternatives?: number; // 최대 대안 수 (기본: 1)
  autoRestart?: boolean;   // 자동 재시작 (기본: true)
}

/**
 * Web Speech API 래퍼 클래스
 */
export class WebSpeechRecognizer {
  private recognition: ISpeechRecognition | null = null;
  private isListening: boolean = false;
  private isPaused: boolean = false;
  private autoRestart: boolean = true;
  private callbacks: WebSpeechCallbacks;
  private config: WebSpeechConfig;

  constructor(callbacks: WebSpeechCallbacks, config: WebSpeechConfig = {}) {
    this.callbacks = callbacks;
    this.config = {
      lang: config.lang || 'ko-KR',
      continuous: config.continuous ?? true,
      interimResults: config.interimResults ?? true,
      maxAlternatives: config.maxAlternatives || 1,
      autoRestart: config.autoRestart ?? true,
    };
    this.autoRestart = this.config.autoRestart!;
    this.init();
  }

  /**
   * Web Speech API 지원 여부 확인
   */
  static isSupported(): boolean {
    return !!(
      typeof window !== 'undefined' &&
      (window.SpeechRecognition || window.webkitSpeechRecognition)
    );
  }

  /**
   * 초기화
   */
  private init(): void {
    if (typeof window === 'undefined') {
      console.warn('🎤 WebSpeechRecognizer: window 객체 없음 (SSR)');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      console.error('🎤 Web Speech API를 지원하지 않는 브라우저입니다.');
      this.callbacks.onError?.('Web Speech API not supported');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = this.config.continuous!;
    this.recognition.interimResults = this.config.interimResults!;
    this.recognition.lang = this.config.lang!;
    this.recognition.maxAlternatives = this.config.maxAlternatives!;

    // 결과 수신
    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      const lastResultIndex = event.results.length - 1;
      const result = event.results[lastResultIndex];
      const transcript = result[0].transcript.trim();
      const isFinal = result.isFinal;

      console.log(`🎤 [WebSpeech] ${isFinal ? '최종' : '중간'}: "${transcript}"`);
      
      if (transcript) {
        this.callbacks.onResult(transcript, isFinal);
      }
    };

    // 인식 시작
    this.recognition.onstart = () => {
      console.log('🎤 [WebSpeech] 음성 인식 시작');
      this.isListening = true;
      this.callbacks.onStart?.();
    };

    // 인식 종료
    this.recognition.onend = () => {
      console.log('🎤 [WebSpeech] 음성 인식 종료');
      this.isListening = false;
      this.callbacks.onEnd?.();

      // 자동 재시작 (pause 상태가 아닐 때만)
      if (this.autoRestart && !this.isPaused) {
        console.log('🎤 [WebSpeech] 자동 재시작...');
        setTimeout(() => {
          if (!this.isPaused && this.recognition) {
            try {
              this.recognition.start();
            } catch (e) {
              console.log('🎤 [WebSpeech] 재시작 실패 (이미 실행 중일 수 있음)');
            }
          }
        }, 100);
      }
    };

    // 에러 처리
    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('🎤 [WebSpeech] 에러:', event.error);
      
      // 'no-speech'는 무시 (자동 재시작됨)
      if (event.error === 'no-speech') {
        console.log('🎤 [WebSpeech] 음성 없음 - 계속 대기');
        return;
      }

      // 'aborted'는 의도적 중단
      if (event.error === 'aborted') {
        console.log('🎤 [WebSpeech] 의도적 중단');
        return;
      }

      this.callbacks.onError?.(event.error);
    };

    // 음성 감지 시작
    this.recognition.onspeechstart = () => {
      console.log('🎤 [WebSpeech] 음성 감지됨');
      this.callbacks.onSpeechStart?.();
    };

    // 음성 감지 종료
    this.recognition.onspeechend = () => {
      console.log('🎤 [WebSpeech] 음성 감지 종료');
      this.callbacks.onSpeechEnd?.();
    };

    console.log('🎤 [WebSpeech] 초기화 완료 - 언어:', this.config.lang);
  }

  /**
   * 음성 인식 시작
   */
  start(): void {
    if (!this.recognition) {
      console.error('🎤 [WebSpeech] recognition 객체 없음');
      return;
    }

    if (this.isListening) {
      console.log('🎤 [WebSpeech] 이미 인식 중');
      return;
    }

    this.isPaused = false;
    
    try {
      this.recognition.start();
      console.log('🎤 [WebSpeech] start() 호출');
    } catch (e) {
      console.error('🎤 [WebSpeech] start() 에러:', e);
    }
  }

  /**
   * 음성 인식 중지
   */
  stop(): void {
    if (!this.recognition) return;

    this.isPaused = true;
    this.autoRestart = false;
    
    try {
      this.recognition.stop();
      console.log('🎤 [WebSpeech] stop() 호출');
    } catch (e) {
      console.log('🎤 [WebSpeech] stop() 에러 (무시):', e);
    }
  }

  /**
   * 일시 정지 (재시작 방지용)
   */
  pause(): void {
    if (!this.recognition) return;

    this.isPaused = true;
    
    try {
      this.recognition.abort();
      console.log('🎤 [WebSpeech] pause() - abort 호출');
    } catch (e) {
      console.log('🎤 [WebSpeech] pause() 에러 (무시):', e);
    }
  }

  /**
   * 일시 정지 해제 및 재시작
   */
  resume(): void {
    if (!this.recognition) return;

    this.isPaused = false;
    this.autoRestart = this.config.autoRestart!;
    
    try {
      this.recognition.start();
      console.log('🎤 [WebSpeech] resume() - start 호출');
    } catch (e) {
      console.log('🎤 [WebSpeech] resume() 에러 (무시):', e);
    }
  }

  /**
   * 현재 인식 중인지 확인
   */
  getIsListening(): boolean {
    return this.isListening;
  }

  /**
   * 일시 정지 상태인지 확인
   */
  getIsPaused(): boolean {
    return this.isPaused;
  }

  /**
   * 언어 변경
   */
  setLanguage(lang: string): void {
    if (this.recognition) {
      this.recognition.lang = lang;
      this.config.lang = lang;
      console.log('🎤 [WebSpeech] 언어 변경:', lang);
    }
  }

  /**
   * 정리 (컴포넌트 언마운트 시)
   */
  destroy(): void {
    this.isPaused = true;
    this.autoRestart = false;
    
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {}
      this.recognition = null;
    }
    
    console.log('🎤 [WebSpeech] destroyed');
  }
}

export default WebSpeechRecognizer;
