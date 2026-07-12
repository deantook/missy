import { ThemeToggle } from "../components/ThemeToggle.tsx";
import styles from "./LandingPage.module.css";
import previewStyles from "./LandingPreview.module.css";

type LandingPageProps = {
  navigate: (path: string) => void;
};

export function LandingPage({ navigate }: LandingPageProps) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.logo} onClick={() => navigate("/")} aria-label="Missy 首页">
          <span>✦</span>
          <strong>Missy</strong>
        </button>
        <nav aria-label="主页导航">
          <a href="#features">功能</a>
          <a href="#how-it-works">使用方式</a>
        </nav>
        <div className={styles.actions}>
          <ThemeToggle />
          <button type="button" className={styles.login} onClick={() => navigate("/login")}>
            登录
          </button>
          <button type="button" className={styles.primary} onClick={() => navigate("/register")}>
            免费开始
          </button>
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.copy}>
          <p className={styles.badge}>
            <span>✦</span> 你的滴答清单 AI 助手
          </p>
          <h1>
            说出想法，
            <br />
            <em>让计划发生。</em>
          </h1>
          <p className={styles.description}>
            Missy 连接你的滴答清单。用自然语言创建任务、调整日程、查询进度，把琐碎的管理交给 AI。
          </p>
          <div className={styles.heroActions}>
            <button type="button" className={styles.heroPrimary} onClick={() => navigate("/register")}>
              开始使用 <span>→</span>
            </button>
            <button type="button" className={styles.secondary} onClick={() => navigate("/login")}>
              已有账户，登录
            </button>
          </div>
          <p className={styles.note}>
            <span>✓</span> 几分钟完成连接&nbsp;&nbsp; <span>✓</span> 你的数据按账户隔离
          </p>
        </div>

        <div className={previewStyles.visual} aria-label="Missy 对话界面示意图">
          <div className={previewStyles.glow} />
          <div className={previewStyles.window}>
            <div className={previewStyles.sidebar}>
              <div className={previewStyles.brand}>
                <span>✦</span>
                <b>Missy</b>
              </div>
              <small>最近对话</small>
              <i className={previewStyles.active} />
              <i />
              <i className={previewStyles.short} />
            </div>
            <div className={previewStyles.chat}>
              <div className={previewStyles.top}>
                <span>今天的安排</span>
                <i />
              </div>
              <div className={previewStyles.messages}>
                <div className={previewStyles.date}>今天</div>
                <div className={previewStyles.user}>帮我安排明天下午写周报，预留 1 小时</div>
                <div className={previewStyles.reply}>
                  <span className={previewStyles.mark}>✦</span>
                  <div>
                    <b>已经安排好了</b>
                    <p>明天 15:00–16:00 · 写周报</p>
                    <small>
                      <i>✓</i> 已同步到滴答清单
                    </small>
                  </div>
                </div>
              </div>
              <div className={previewStyles.composer}>
                继续告诉 Missy…
                <b>↑</b>
              </div>
            </div>
          </div>
          <div className={`${previewStyles.float} ${previewStyles.task}`}>
            <span>✓</span>
            <div>
              <b>任务已创建</b>
              <small>明天 15:00</small>
            </div>
          </div>
          <div className={`${previewStyles.float} ${previewStyles.status}`}>
            <i /> 滴答清单已连接
          </div>
        </div>
      </section>

      <section id="features" className={styles.features}>
        <div className={styles.featuresHead}>
          <p className={styles.eyebrow}>ONE CONVERSATION, MORE DONE</p>
          <h2>少一点整理，多一点完成</h2>
        </div>
        <div className={styles.grid}>
          <article>
            <span>01</span>
            <h3>自然语言管理</h3>
            <p>像聊天一样创建、修改和完成任务，不必在菜单间来回切换。</p>
          </article>
          <article>
            <span>02</span>
            <h3>理解你的日程</h3>
            <p>查询今天、未来一周或指定清单，让下一步始终清晰。</p>
          </article>
          <article id="how-it-works">
            <span>03</span>
            <h3>安全连接滴答</h3>
            <p>使用你自己的 Token 连接，账户数据彼此隔离，随时可以退出。</p>
          </article>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.logo}>
          <span>✦</span>
          <strong>Missy</strong>
        </div>
        <p>让每个计划，都有下一步。</p>
      </footer>
    </main>
  );
}
