# InterviewBudAI

InterviewBudAI (say "Interview Buddy") helps you prepare for data structures
and algorithms (DSA) interviews. It runs on your own computer, and your notes
and progress stay there. You bring your own AI: a cloud model such as Claude,
or a local model. The app ships a list of problems with links and difficulty
only, never answers.

- **Catalog:** curated problems by topic, with search and filters.
- **Notes:** your own notes and code per problem, next to the problem
  statement.
- **Quiz:** a quick quiz on the problems you have solved.
- **Intuition check:** ask the AI if your approach is on track, without
  getting the answer.
- **Analytics:** your progress, weak topics, and what to focus on next.

## Quick start

This example uses Claude with an Anthropic API key.

You need [Node.js 24 LTS](https://nodejs.org/) or newer, and git.

1. Get the code and install it:

   ```bash
   git clone https://github.com/coderbirju/InterviewBudAI.git
   cd InterviewBudAI
   npm ci
   ```

2. Create a file named `.env` in the `InterviewBudAI` folder with your key
   and a model name. Both lines are required:

   ```bash
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   IBAI_ANTHROPIC_MODEL=claude-opus-5-5
   ```

3. Start the app:

   ```bash
   npm start
   ```

   The first start builds the app, which takes a short while. Then open the
   address it prints, <http://127.0.0.1:4173/>. Stop it with Ctrl+C.

Your notes are saved in `~/.interviewbudai/data`. See
[Your data](docs/data.md).

## Other AI providers

You can also use OpenAI, a local server such as LM Studio or Ollama, or
Docker Model Runner. See [AI providers](docs/providers.md).

## Local AI with Docker (no API key)

The Compose file runs the app and a local AI model, through Docker Model
Runner. You need no account and no key.

You need:

- Docker Desktop with **Model Runner turned on**: in Docker Desktop, open
  Settings, then AI, then check "Enable Docker Model Runner".
- About **8 GB of RAM**. The default model uses about 3.5 GB (an estimate).
- About **4 GB of free disk space**. The default model is a 2.5 GB download,
  and the app image adds a few hundred MB.

Then run this in the `InterviewBudAI` folder:

```bash
docker compose up
```

Open <http://localhost:4173>. The first start downloads the model, so it can
take a while.

Under Docker your notes are in the same folder, `~/.interviewbudai/data`. See
[Docker details](docs/docker.md) for Linux, Windows, other folders, and
changing the model.

## More documentation

[AI providers](docs/providers.md) ·
[Configuration](docs/configuration.md) · [Your data](docs/data.md) ·
[Problem statements](docs/problem-statements.md) ·
[Docker](docs/docker.md) · [Releases](docs/releases.md) ·
[Development](docs/development.md)
