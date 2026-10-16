// The same five-page site in Chinese, Japanese, Korean and English, and the same 8 questions its
// pages answer, each with the page that answers it. test/docs-claims.test.ts measures keyword
// search on them, for the counts the limits page quotes.
import type { SourceDocument } from '../src';

export type SiteLanguage = 'zh' | 'ja' | 'ko' | 'en';

/** Five pages: install, config, deploy, search and dialog, in each language. */
export const SITES: Record<SiteLanguage, SourceDocument[]> = {
  zh: [
    {
      id: 'install',
      url: '/zh/docs/install',
      title: '安装',
      content: `## 安装插件

使用 npm 安装插件：运行 npm install ondocs。安装完成后重新启动开发服务器。

## 系统要求

需要 Node.js 22 或更高版本。`,
    },
    {
      id: 'config',
      url: '/zh/docs/config',
      title: '配置',
      content: `## 配置模型

在配置文件中设置语言模型和嵌入模型。默认使用 OpenAI 的模型。

## 环境变量

把 API 密钥写入环境变量 OPENAI_API_KEY。`,
    },
    {
      id: 'deploy',
      url: '/zh/docs/deploy',
      title: '部署',
      content: `## 部署到 Vercel

把站点推送到 Git 仓库，然后在 Vercel 中导入项目。部署时需要设置环境变量。

## 部署到 Netlify

在 Netlify 中创建站点并连接仓库。`,
    },
    {
      id: 'search',
      url: '/zh/docs/search',
      title: '搜索',
      content: `## 关键词搜索

没有嵌入模型时，搜索只使用关键词。

## 语义搜索

使用嵌入模型时，搜索按含义匹配问题和页面。`,
    },
    {
      id: 'dialog',
      url: '/zh/docs/dialog',
      title: '对话框',
      content: `## 打开对话框

按 ⌘I 打开提问对话框。

## 自定义文字

用 labels 选项把对话框中的文字翻译成你的语言。`,
    },
  ],
  ja: [
    {
      id: 'install',
      url: '/ja/docs/install',
      title: 'インストール',
      content: `## プラグインをインストールする

npm でプラグインをインストールします。npm install ondocs を実行してください。インストール後、開発サーバーを再起動します。

## 動作環境

Node.js 22 以降が必要です。`,
    },
    {
      id: 'config',
      url: '/ja/docs/config',
      title: '設定',
      content: `## モデルを設定する

設定ファイルで言語モデルと埋め込みモデルを指定します。既定では OpenAI のモデルを使います。

## 環境変数

API キーを環境変数 OPENAI_API_KEY に設定します。`,
    },
    {
      id: 'deploy',
      url: '/ja/docs/deploy',
      title: 'デプロイ',
      content: `## Vercel にデプロイする

サイトを Git リポジトリにプッシュし、Vercel でプロジェクトをインポートします。デプロイ時に環境変数を設定してください。

## Netlify にデプロイする

Netlify でサイトを作成し、リポジトリを接続します。`,
    },
    {
      id: 'search',
      url: '/ja/docs/search',
      title: '検索',
      content: `## キーワード検索

埋め込みモデルがない場合、検索はキーワードだけを使います。

## 意味検索

埋め込みモデルを使うと、質問とページを意味で照合します。`,
    },
    {
      id: 'dialog',
      url: '/ja/docs/dialog',
      title: 'ダイアログ',
      content: `## ダイアログを開く

⌘I を押すと質問ダイアログが開きます。

## 文言を変更する

labels オプションでダイアログの文言を翻訳できます。`,
    },
  ],
  ko: [
    {
      id: 'install',
      url: '/ko/docs/install',
      title: '설치',
      content: `## 플러그인 설치

npm으로 플러그인을 설치합니다. npm install ondocs 를 실행하세요. 설치가 끝나면 개발 서버를 다시 시작합니다.

## 요구 사항

Node.js 22 이상이 필요합니다.`,
    },
    {
      id: 'config',
      url: '/ko/docs/config',
      title: '설정',
      content: `## 모델 설정

설정 파일에서 언어 모델과 임베딩 모델을 지정합니다. 기본값은 OpenAI 모델입니다.

## 환경 변수

API 키를 환경 변수 OPENAI_API_KEY 에 넣습니다.`,
    },
    {
      id: 'deploy',
      url: '/ko/docs/deploy',
      title: '배포',
      content: `## Vercel에 배포

사이트를 Git 저장소에 푸시한 다음 Vercel에서 프로젝트를 가져옵니다. 배포할 때 환경 변수를 설정하세요.

## Netlify에 배포

Netlify에서 사이트를 만들고 저장소를 연결합니다.`,
    },
    {
      id: 'search',
      url: '/ko/docs/search',
      title: '검색',
      content: `## 키워드 검색

임베딩 모델이 없으면 검색은 키워드만 사용합니다.

## 의미 검색

임베딩 모델을 사용하면 질문과 페이지를 의미로 비교합니다.`,
    },
    {
      id: 'dialog',
      url: '/ko/docs/dialog',
      title: '대화 상자',
      content: `## 대화 상자 열기

⌘I 를 누르면 질문 대화 상자가 열립니다.

## 문구 변경

labels 옵션으로 대화 상자의 문구를 번역할 수 있습니다.`,
    },
  ],
  en: [
    {
      id: 'install',
      url: '/docs/install',
      title: 'Installation',
      content: `## Install the plugin

Install the plugin with npm: run npm install ondocs. Restart the dev server when it is installed.

## Requirements

You need Node.js 22 or later.`,
    },
    {
      id: 'config',
      url: '/docs/config',
      title: 'Configuration',
      content: `## Configure the model

Set the language model and the embedding model in the config file. The default is an OpenAI model.

## Environment variables

Put the API key in the environment variable OPENAI_API_KEY.`,
    },
    {
      id: 'deploy',
      url: '/docs/deploy',
      title: 'Deploying',
      content: `## Deploy to Vercel

Push the site to a Git repository, then import the project in Vercel. Set the environment variables when you deploy.

## Deploy to Netlify

Create a site in Netlify and connect the repository.`,
    },
    {
      id: 'search',
      url: '/docs/search',
      title: 'Search',
      content: `## Keyword search

Without an embedding model, search uses keywords only.

## Semantic search

With an embedding model, search matches questions and pages by meaning.`,
    },
    {
      id: 'dialog',
      url: '/docs/dialog',
      title: 'Dialog',
      content: `## Open the dialog

Press ⌘I to open the question dialog.

## Change the text

Translate the dialog text into your language with the labels option.`,
    },
  ],
};

/** The 8 questions, as a reader asks them, each with the id of the page that answers it. */
export const QUESTIONS: Record<SiteLanguage, (readonly [question: string, page: string])[]> = {
  zh: [
    ['怎么安装插件？', 'install'],
    ['如何配置模型？', 'config'],
    ['怎么部署到 Vercel？', 'deploy'],
    ['需要什么版本的 Node.js？', 'install'],
    ['API 密钥放在哪里？', 'config'],
    ['怎么打开对话框？', 'dialog'],
    ['如何翻译对话框的文字？', 'dialog'],
    ['没有嵌入模型能搜索吗？', 'search'],
  ],
  ja: [
    ['プラグインをインストールするには？', 'install'],
    ['モデルを設定する方法は？', 'config'],
    ['Vercel にデプロイするには？', 'deploy'],
    ['Node.js のバージョンは何が必要ですか？', 'install'],
    ['API キーはどこに設定しますか？', 'config'],
    ['ダイアログを開くには？', 'dialog'],
    ['ダイアログの文言を翻訳できますか？', 'dialog'],
    ['埋め込みモデルなしで検索できますか？', 'search'],
  ],
  ko: [
    ['플러그인을 어떻게 설치하나요?', 'install'],
    ['모델은 어떻게 설정하나요?', 'config'],
    ['Vercel에 어떻게 배포하나요?', 'deploy'],
    ['Node.js 버전은 무엇이 필요한가요?', 'install'],
    ['API 키는 어디에 넣나요?', 'config'],
    ['대화 상자는 어떻게 여나요?', 'dialog'],
    ['대화 상자의 문구를 번역할 수 있나요?', 'dialog'],
    ['임베딩 모델 없이 검색할 수 있나요?', 'search'],
  ],
  en: [
    ['How do I install the plugin?', 'install'],
    ['How do I configure the model?', 'config'],
    ['How do I deploy to Vercel?', 'deploy'],
    ['Which Node.js version do I need?', 'install'],
    ['Where does the API key go?', 'config'],
    ['How do I open the dialog?', 'dialog'],
    ['Can I translate the dialog text?', 'dialog'],
    ['Can I search without an embedding model?', 'search'],
  ],
};
