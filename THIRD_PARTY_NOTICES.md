# 第三方组件与素材说明

## 运行依赖

项目的直接依赖及精确版本记录在 `package-lock.json`。主要运行时组件包括：

- Next.js、React、React DOM；
- LangChain Core、LangGraph 和 LangGraph Checkpoint；
- Zod；
- Lucide React；
- Tesseract.js 及中英文数据；
- PDF Parse、Cheerio、Sharp、ZXing Browser；
- Yet Another React Lightbox。

这些组件保留各自上游许可证和版权声明。发布镜像或安装包时应同时分发 `node_modules` 中对应包的许可证文件。项目没有通过依赖默认启用远程托管记忆、追踪或训练服务。

## 开放资料与图片

演示素材的来源、许可和用途记录在：

- `public/demo/life/SOURCES.json`
- `public/demo/stories/SOURCES.json`
- `public/demo/objects-v1/SOURCES.json`

其中：

- `life` 分类照片是来自 Unsplash 的示意图片，不是具体型号实拍；
- `stories` 是独立公开场景照片，只用于明确标记的虚构故事；
- `objects-v1` 是通过图像生成工具制作的类别插图，不是真实物品、品牌产品照、说明书证据或用户经历。

## 商品资料

产品资料包可能摘录或链接官方公开页面。原始页面及商标归各自权利人所有，不以本项目代码许可证重新授权。资料包用于演示证据绑定，不代表制造商背书，也不保证覆盖所有地区版本。

## 内容责任

合成故事、演示物品、家庭角色和 AI 生成创意均不代表真实用户数据或现实世界验证。若将本项目用于生产环境，部署者需要自行确认内容许可、隐私政策、数据处理义务和适用法规。
