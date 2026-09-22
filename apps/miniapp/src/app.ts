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
import { clear, h } from './ui/dom.js';
import { menuPage } from './ui/menu.js';
import { bottomNav, type Tab } from './ui/nav.js';
import { profilePage } from './ui/profile.js';
import { resultScreen, type ResultView } from './ui/result.js';
import { errorState, loadingState, matchLoadingState } from './ui/states.js';

/** أقل زمن تُعرض فيه شاشة التجهيز كي لا تومض ثم تختفي. */
const MATCH_LOADING_MS = 850;

/**
 * منسّق الشاشات: (الرئيسية | الملف الشخصي) ← تجهيز ← جولة ← نتيجة.
 * كل شاشة تُبنى عند الحاجة وتُزال بالكامل عند الخروج منها.
 */
export class App {
  private readonly api = new ApiClient();
  private session: AuthResponse | null = null;
  private game: GameScreen | null = null;
  private tab: Tab = 'home';

  constructor(private readonly root: HTMLElement) {}

  async boot(): Promise<void> {
    initTelegram();
    this.show(loadingState('جاري التحميل…'));

    try {
      this.session = await this.api.authenticate(getInitData());
      this.showTab('home');
    } catch (error) {
      this.showAuthError(error);
    }
  }

  // ------------------------------------------------------------- الشاشات

  private show(element: HTMLElement): void {
    clear(this.root);
    this.root.append(element);
  }

  /** الهيكل الثابت: صفحة متغيّرة + تنقّل سفلي. */
  private showTab(tab: Tab): void {
    if (!this.session) return;
    this.tab = tab;
    setClosingConfirmation(false);

    const content =
      tab === 'home'
        ? menuPage(this.session, {
            onPlay: () => void this.play(),
            onOpenProfile: () => this.showTab('profile'),
          })
        : [profilePage(this.session)];

    this.show(
      h('div', { class: 'screen shell' }, [
        ...content,
        bottomNav(tab, (next) => this.showTab(next)),
      ]),
    );

    // زر رجوع تيليجرام يعيد إلى الرئيسية من الملف الشخصي فقط.
    setBackButton(tab === 'profile' ? () => this.showTab('home') : null);
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
        apiError ? undefined : describe(error),
      ),
    );
  }

  // -------------------------------------------------------------- الجولة

  private async play(): Promise<void> {
    this.show(matchLoadingState());
    setBackButton(null);

    const started = Date.now();
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

    await delay(MATCH_LOADING_MS - (Date.now() - started));

    clear(this.root);
    setClosingConfirmation(true);
    this.game = new GameScreen(
      descriptor,
      (summary) => void this.finishRound(summary),
      () => this.showTab('home'),
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

    this.show(resultScreen(view, () => void this.play(), () => this.showTab('home')));
    setBackButton(() => this.showTab('home'));
  }
}

/** وصف مختصر لخطأ غير متوقع، بلا مسار ملفات طويل. */
function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 160);
  return String(error).slice(0, 160);
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
