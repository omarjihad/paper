import {
  DEFAULT_REGION,
  type AuthResponse,
  type RegionId,
  type RegionInfo,
  type RoomDescriptor,
} from '@riqaa/shared';
import { GameScreen, type RoundSource, type RoundSummary } from './game/gameScreen.js';
import { ApiClient, ApiError } from './net/api.js';
import { RealtimeClient } from './net/realtime.js';
import { reportClientError } from './net/report.js';
import {
  getInitData,
  initTelegram,
  isInsideTelegram,
  requestLandscape,
  setBackButton,
  setClosingConfirmation,
} from './telegram.js';
import { clear, h } from './ui/dom.js';
import { menuPage } from './ui/menu.js';
import { bottomNav, type Tab } from './ui/nav.js';
import { profilePage } from './ui/profile.js';
import { serverListScreen, type ServerListHandle } from './ui/serverList.js';
import { resultScreen, type ResultView } from './ui/result.js';
import { errorState, loadingState, matchLoadingState } from './ui/states.js';

/** مدة إظهار سبب التحويل إلى الجولة المحلية. */
const FALLBACK_NOTICE_MS = 1500;

/**
 * منسّق الشاشات: (الرئيسية | الملف الشخصي) ← تجهيز ← جولة ← نتيجة.
 * كل شاشة تُبنى عند الحاجة وتُزال بالكامل عند الخروج منها.
 */
export class App {
  private readonly api = new ApiClient();
  private readonly net = new RealtimeClient();
  private session: AuthResponse | null = null;
  private game: GameScreen | null = null;
  private tab: Tab = 'home';
  private region: RegionId = DEFAULT_REGION;
  private regions: readonly RegionInfo[] = [];
  /** يفك ارتباط مستمعي شاشة المطابقة عند مغادرتها. */
  private lobbyUnbind: (() => void)[] = [];
  /** تنبيه يُعرض في شاشة النتيجة حين تكون الجولة محلية لا جماعية. */
  private localNotice: string | null = null;

  constructor(private readonly root: HTMLElement) {}

  async boot(): Promise<void> {
    // المرحلة تُرسل مع أي خطأ، فيُعرف موضع الانهيار من سطر واحد في السجل.
    let stage = 'بدء';
    try {
      stage = 'تهيئة-تيليجرام';
      initTelegram();

      this.show(loadingState('جاري التحميل…'));

      stage = 'مصادقة';
      this.session = await this.api.authenticate(getInitData());

      stage = 'رسم-القائمة';
      this.showTab('home');
    } catch (error) {
      if (!(error instanceof ApiError)) reportClientError(stage, error);
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

  /**
   * مسار اللعب: اتصال → اختيار سيرفر → ضغط «ابدأ» → عد تنازلي → جولة.
   * لا انطلاق تلقائي: اللاعب يرى أين يجلس الآخرون ويقرّر بنفسه متى يبدأ.
   * وإن تعذّر الوصول إلى الخادم تُلعب جولة محلية ضد بوتات، ويُعلَن ذلك صراحةً.
   */
  private async play(): Promise<void> {
    // أول سطر في معالج الضغط: سياق لمسة المستخدم ما زال قائمًا هنا،
    // وملء شاشة المتصفح لا يُسمح به خارجه. أي تأخير يُفقد هذا السياق.
    requestLandscape();
    setBackButton(null);
    setClosingConfirmation(true);

    const lobby: ServerListHandle = serverListScreen({
      onPick: (id) => this.net.join(id),
      onStart: () => this.net.start(),
      onCancel: () => this.leaveLobby(),
    });
    lobby.setServers([], null);
    this.show(lobby.element);

    try {
      await this.connectRealtime(lobby);
    } catch (error) {
      // يُعرض السبب لحظةً قبل التحويل، فلا ينتقل اللاعب إلى وضع آخر بلا تفسير.
      lobby.setNotice('تعذّر الاتصال بخادم اللعب الجماعي');
      await delay(FALLBACK_NOTICE_MS);
      await this.playLocal(error);
      return;
    }

    this.bindLobby(lobby);
    this.net.watchLobby();
  }

  /** يفتح الوصلة ويصادق عليها برمز الجلسة، مع محاولة تجديد واحدة. */
  private async connectRealtime(lobby: ServerListHandle): Promise<void> {
    if (this.net.open) {
      lobby.setPing(this.net.pingMs);
      return;
    }
    lobby.setNotice('جارٍ الاتصال بالخادم…');

    let token = this.api.getToken();
    if (!token) {
      this.session = await this.api.authenticate(getInitData());
      token = this.api.getToken();
    }

    let welcome;
    try {
      welcome = await this.net.connect(token ?? '');
    } catch {
      // الرمز قد يكون منتهيًا: نجدّده من تيليجرام ونحاول مرة واحدة فقط.
      this.session = await this.api.authenticate(getInitData());
      welcome = await this.net.connect(this.api.getToken() ?? '');
    }

    this.regions = welcome.regions;
    this.region = welcome.serverRegion;
    lobby.setRegion(this.region, this.regions);
    lobby.setPing(this.net.pingMs);
  }

  private bindLobby(lobby: ServerListHandle): void {
    this.releaseLobby();
    const pingTimer = window.setInterval(() => lobby.setPing(this.net.pingMs), 700);

    this.lobbyUnbind.push(
      () => window.clearInterval(pingTimer),
      this.net.on('lobby', (message) => {
        this.region = message.serverRegion;
        lobby.setRegion(this.region, this.regions);
        lobby.setServers(message.servers, message.yourServerId);
      }),
      this.net.on('room', (message) => this.enterRoom(message.room)),
      this.net.watchLink((state) => {
        if (state === 'reconnecting') lobby.setNotice('انقطع الاتصال — جارٍ العودة…');
        if (state === 'live') this.net.watchLobby();
      }),
      this.net.on('error', (message) => {
        // رفضُ انضمامٍ ليس سببًا لترك الشاشة: يُعرض السبب ويبقى الاختيار قائمًا.
        if (message.code === 'join_failed' || message.code === 'start_failed') {
          lobby.setNotice(message.message);
          return;
        }
        this.releaseLobby();
        if (message.code === 'duplicate_session' || message.code === 'protocol_mismatch') {
          this.net.shutdown();
          setClosingConfirmation(false);
          this.show(
            errorState(
              message.code === 'duplicate_session' ? 'اللعبة مفتوحة في مكان آخر' : 'نسخة قديمة',
              message.message,
              () => void this.play(),
            ),
          );
          return;
        }
        lobby.setNotice(message.message);
        void this.playLocal(new Error(message.message));
      }),
    );
  }

  private leaveLobby(): void {
    this.releaseLobby();
    if (this.net.open) this.net.leave();
    setClosingConfirmation(false);
    this.showTab('home');
  }

  private releaseLobby(): void {
    for (const off of this.lobbyUnbind) off();
    this.lobbyUnbind = [];
  }

  /** الغرفة جاهزة: تُبنى شاشة اللعب من وصف الخادم وحده. */
  private enterRoom(room: RoomDescriptor): void {
    // وصول «room» أثناء جولة قائمة يعني عودة بعد انقطاع — الشاشة تعالجه بنفسها.
    if (this.game) return;
    this.releaseLobby();

    const source: RoundSource = {
      matchId: room.roomId,
      seed: room.seed,
      config: room.config,
      participants: room.participants,
      localActorId: room.youActorId,
      net: this.net,
      state: room.state,
      startsInMs: room.startsInMs,
    };
    this.startGame(source);
  }

  /** جولة محلية ضد بوتات — المسار الاحتياطي حين يتعذّر اللعب الجماعي. */
  private async playLocal(reason: unknown): Promise<void> {
    this.show(matchLoadingState());
    let descriptor;
    try {
      descriptor = await this.api.startMatch();
    } catch (error) {
      if (!(error instanceof ApiError)) reportClientError('بدء-الجولة', error);
      this.show(
        errorState(
          'تعذّر بدء الجولة',
          error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع.',
          () => void this.play(),
          error instanceof ApiError ? undefined : describe(error),
        ),
      );
      return;
    }

    const human = descriptor.participants.find((participant) => participant.kind === 'human');
    const why = reason instanceof Error ? reason.message : String(reason ?? '');
    this.localNotice = `${why || 'تعذّر الاتصال بخادم اللعب الجماعي'} — هذه جولة محلية ضد بوتات معلنة، لا جولة جماعية.`;
    this.startGame({
      matchId: descriptor.matchId,
      seed: descriptor.seed,
      config: descriptor.config,
      participants: descriptor.participants,
      localActorId: human?.actorId ?? 1,
      net: null,
      state: 'PLAYING',
      startsInMs: 0,
    });
  }

  private startGame(source: RoundSource): void {
    clear(this.root);
    setClosingConfirmation(true);
    this.game = new GameScreen(
      source,
      (summary) => void this.finishRound(summary),
      () => this.showTab('home'),
      this.session?.player.avatarUrl ?? null,
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
      coins: summary.coins,
    };
    if (this.localNotice) {
      view.warning = this.localNotice;
      this.localNotice = null;
    }

    if (summary.server) {
      // الجولة الجماعية: الخادم حسب النتيجة وحفظها، فلا نعيد إرسال شيء.
      view.bestAreaPercent = summary.server.bestAreaPercent;
      if (this.session) {
        this.session.player.stats.bestAreaPercent = summary.server.bestAreaPercent;
        this.session.player.stats.rounds = summary.server.rounds;
      }
    } else {
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

/** null = لم يختر اللاعب منطقة بعد. */
function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

