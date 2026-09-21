import type { AuthResponse, MatchStartResponse } from '@riqaa/shared';
import { GameScreen, type RoundSummary } from './game/gameScreen.js';
import { ApiClient, ApiError } from './net/api.js';
import {
  getInitData,
  initTelegram,
  isInsideTelegram,
  setBackButton,
  setClosingConfirmation,
} from './telegram.js';
import { clear } from './ui/dom.js';
import { menuScreen } from './ui/menu.js';
import { resultScreen, type ResultView } from './ui/result.js';
import { errorState, loadingState } from './ui/states.js';

/**
 * منسّق الشاشات: قائمة ← جولة ← نتيجة.
 * كل شاشة تُبنى عند الحاجة وتُزال بالكامل عند الخروج منها — لا تراكم في الذاكرة.
 */
export class App {
  private readonly api = new ApiClient();
  private session: AuthResponse | null = null;
  private game: GameScreen | null = null;

  constructor(private readonly root: HTMLElement) {}

  async boot(): Promise<void> {
    initTelegram();
    this.show(loadingState('جارٍ تجهيز اللعبة…'));

    try {
      this.session = await this.api.authenticate(getInitData());
      this.showMenu();
    } catch (error) {
      this.showAuthError(error);
    }
  }

  // ------------------------------------------------------------- الشاشات

  private show(element: HTMLElement): void {
    clear(this.root);
    this.root.append(element);
  }

  private showMenu(): void {
    if (!this.session) return;
    setBackButton(null);
    setClosingConfirmation(false);
    this.show(menuScreen(this.session, () => void this.play()));
  }

  private showAuthError(error: unknown): void {
    const apiError = error instanceof ApiError ? error : null;

    if (apiError?.code === 'telegram_required' || (!isInsideTelegram && apiError?.status === 401)) {
      this.show(
        errorState(
          'افتح اللعبة من تيليجرام',
          'هذه اللعبة تعمل داخل تيليجرام فقط، لأن هويتك فيها هي حسابك في تيليجرام.',
        ),
      );
      return;
    }

    this.show(
      errorState(
        'تعذّر بدء اللعبة',
        apiError?.message ?? 'حدث خطأ غير متوقع، حاول مرة أخرى.',
        () => void this.boot(),
      ),
    );
  }

  // -------------------------------------------------------------- الجولة

  private async play(): Promise<void> {
    this.show(loadingState('جارٍ تجهيز الجولة…'));

    let descriptor: MatchStartResponse;
    try {
      descriptor = await this.api.startMatch();
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'token_expired' || error.code === 'token_invalid')) {
        // الجلسة انتهت: أعد التحقق من تيليجرام ثم حاول مرة واحدة.
        try {
          this.session = await this.api.authenticate(getInitData());
          descriptor = await this.api.startMatch();
        } catch (retryError) {
          this.showAuthError(retryError);
          return;
        }
      } else {
        this.show(
          errorState(
            'تعذّر بدء الجولة',
            error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع.',
            () => void this.play(),
          ),
        );
        return;
      }
    }

    clear(this.root);
    setClosingConfirmation(true);
    this.game = new GameScreen(
      descriptor,
      (summary) => void this.finishRound(summary),
      () => this.showMenu(),
    );
    this.game.mount(this.root);
    setBackButton(() => this.game?.quit());
  }

  private async finishRound(summary: RoundSummary): Promise<void> {
    this.game?.destroy();
    this.game = null;
    setClosingConfirmation(false);

    const view: ResultView = {
      areaPercent: summary.areaPercent,
      rank: summary.rank,
      participants: summary.participants,
      bestAreaPercent: this.session?.player.stats.bestAreaPercent ?? summary.areaPercent,
      outcome: summary.outcome,
    };

    try {
      const saved = await this.api.submitResult({
        matchId: summary.matchId,
        areaPercent: summary.areaPercent,
        rank: summary.rank,
        participants: summary.participants,
        durationMs: summary.durationMs,
        outcome: summary.outcome,
      });
      view.bestAreaPercent = saved.bestAreaPercent;
      if (this.session) {
        this.session.player.stats.bestAreaPercent = saved.bestAreaPercent;
        this.session.player.stats.rounds = saved.rounds;
      }
    } catch {
      // النتيجة لم تُحفظ، لكن اللاعب يرى أرقام جولته على أي حال.
      view.bestAreaPercent = Math.max(view.bestAreaPercent, summary.areaPercent);
      view.warning = 'تعذّر حفظ النتيجة على الخادم، الأرقام المعروضة محلية.';
    }

    this.show(resultScreen(view, () => void this.play(), () => this.showMenu()));
    setBackButton(() => this.showMenu());
  }
}
