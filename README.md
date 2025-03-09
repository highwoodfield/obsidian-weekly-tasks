# Obsidian Weekly Tasks 

Obsidian Weekly Tasks は、 [Obsidian](https://obsidian.md) のためのプラグインです。

このプラグインを導入することで、複数のノートに渡って記述された週ごとの予定や計画を一つのノートで確認することができます。

例えば、以下に示すような内容の `xxx/aaa.md` と `xxx/bbb.md` が存在するとします。

```xxx/aaa.md
# xxx/aaa.md

- 2025/03/03 ~ 2025/03/09
  - foo
- 2025/03/10 ~ 2025/03/16
  - bar
  - 2025/03/12
    - buzz
```

```xxx/bbb.md
# xxx/bbb.md

- 2025/03/10 ~ 2025/03/16
  - hoge
- 2025/03/17 ~ 2025/03/23
  - fuga
```

このとき、 Vault内の任意の場所に配置したノート `ccc.md` に以下のようなコードブロックを書き込みます。

````ccc.md
```weekly-task-collect
xxx
```
````

すると、このプラグインは、コードブロックの中に記述されたフォルダ内を探索し、このブロックを以下のように置き換えて表示します。

```ccc.md
- 2025/03/03 ~ 2025/03/09
  - foo
- 2025/03/10 ~ 2025/03/16
  - 2025/03/12
    - buzz
  - bar
  - hoge
- 2025/03/17 ~ 2025/03/23
  - fuga
```

これで、すべての計画を一つのノートで確認できるようになりました。

## Installation

```
git clone https://url-to-this-repository.example.com
cd path/to/this/repository
npm i
npm run build
mkdir path/to/your/vault/.obsidian/plugin/obsidian-weekly-tasks
cp main.js path/to/your/vault/.obsidian/plugin/obsidian-weekly-tasks/
cp manifest.json path/to/your/vault/.obsidian/plugin/obsidian-weekly-tasks/
```

