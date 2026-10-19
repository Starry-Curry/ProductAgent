import Link from "next/link";
import LegacyGuide from "@/components/LegacyGuide";
export default function Guide() {
  return (
    <div className="guide-page">
      <Link href="/">← 回到物间</Link>
      <h1>物间可以做什么，怎么开始？</h1>
      <section id="cloud" className="panel">
        <h2>在本机配置千问与费用授权</h2>
        <p>
          只编辑当前工作区被 Git 忽略的 .env.local，勿把 Key 发到聊天、Git
          或其他工作区。填写
          AI_API_KEY，AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1，AI_MODEL=qwen-plus，AI_ENABLE_THINKING=false。这里只检查配置，不会自动测试账户或发送请求。
        </p>
        <p>
          默认 npm run start:life
          始终关闭费用。确认愿意产生模型费用后，停止自己的服务，再用 npm run
          start:life -- --cloud
          启动；开发模式同理。授权仅限这次进程，退出后用不带 --cloud
          的命令启动即可撤销。修改配置后需要重启。不要在未授权时点击真实调用或运行联网测试。
        </p>
      </section>
      <p>
        新版围绕真实物品展柜与生活故事：获得实际帮助，发现新用途，按自己的意愿留住生活。
      </p>
      <section className="panel">
        <h2>五条完整体验</h2>
        <ol>
          <li>
            首页载入明确标注的合成案例，或点击“录入物品”，填写名称、品牌、型号，上传照片或解码条码/二维码。核对后才能绑定具体资料包。
          </li>
          <li>
            在物品展柜打开一件物品，使用“帮助”提问。未知型号不猜参数；官方事实、用户提供的资料和一般回答分别标注。可记录尝试与本人反馈。
          </li>
          <li>
            进入“发现新玩法”，填写时间与当前要求。可收藏、记录尝试、拒绝不合适的方向；亦可提交获准使用的经验与来源。状态未知、借出、损坏、数量为零或过期的物品不当作可用。
          </li>
          <li>
            在“生活故事”上传照片、写一句话，可关联多件物品。原文只有一份，可编辑或删除。照片在本机处理并移除
            EXIF 定位；不代表照片识别或实际经历核验。
          </li>
          <li>
            共享物品后在“家庭与礼物”创建事项，由演示成员接手。礼物只携带预览选中的文字快照，接收者的新私人经历不回传。
          </li>
        </ol>
      </section>
      <section className="panel">
        <h2>聊天、记忆与图文记录</h2>
        <p>
          普通交流无需绑定物品。新版默认只保留必要会话历史；可开启待确认记忆候选，确认前不用于长期个性化。临时提问进一步关闭持久历史与记忆整理。“记住”是主动保存指令。个人记忆可以查看来源、确认、纠正、忘记及调整云端授权。
        </p>
        <p>
          生活片段是主动保存的原话和照片，独立于聊天与偏好。删除或更正会使旧上下文失效；旧数据库备份和已经送出的礼物文字快照不在即时擦除范围。
        </p>
      </section>
      <section className="panel">
        <h2>真实能力与当前边界</h2>
        <p>
          默认启动器关闭付费模型。精选指导、资料提取、规则创意、图文与家庭功能可在本机运行；云端问答与创意质量需另获费用授权后验证。未启用视觉模型，没有全品类条码商品库、扫描
          PDF OCR、真实家庭账户、IoT 或后台通知。
        </p>
        <p>
          25 件展柜合成实例包含 10 个已绑定型号，另保留 8 个旧案例。资料目录 11
          包、33 条事实、2 个有限过程；这不等于 11
          份完整说明书。示意照片不是该型号实拍，也不是用户真实物品。
        </p>
        <p>
          新版本机默认 3200 端口与独立 data-life-v1 数据；不要把旧 data
          目录交给新版。接续开发请读 README 和本轮技术交接。
        </p>
      </section>
      <details>
        <summary>旧版操作指南（历史与回退入口）</summary>
        <LegacyGuide />
      </details>
    </div>
  );
}
