import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

const CLEAR_VALUE = 'none';

export const splitList = (text) => text.split(/[,;]/).map((item) => item.trim()).filter(Boolean);

const printOptions = (options) => options.forEach((option, index) => console.log(`  ${index + 1}) ${option}`));

const optionAt = (options, answer) => options[Number(answer) - 1] ?? answer;

export function createPrompter() {
  const readline = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
  const lines = readline[Symbol.asyncIterator]();

  const readLine = async (prompt) => {
    stdout.write(prompt);
    const { value, done } = await lines.next();
    if (done) throw new Error('Input ended before all questions were answered.');
    return value;
  };

  const ask = async (question, fallback = '') => {
    const hint = fallback === '' ? '' : ` (${fallback})`;
    const answer = (await readLine(`? ${question}${hint}: `)).trim();
    if (answer.toLowerCase() === CLEAR_VALUE) return '';
    return answer || String(fallback);
  };

  const list = async (question, fallback = []) => splitList(await ask(question, fallback.join(', ')));

  const choose = async (question, options, fallback) => {
    printOptions(options);
    const defaultIndex = options.indexOf(fallback) + 1;
    return optionAt(options, await ask(question, defaultIndex || fallback));
  };

  const pick = async (question, options, fallback) => {
    printOptions(options);
    const defaults = fallback.map((item) => options.indexOf(item) + 1).join(',');
    const answers = splitList(await ask(`${question} (comma-separated numbers)`, defaults));
    return answers.map((answer) => optionAt(options, answer));
  };

  const confirm = async (question, fallback = true) => /^y/i.test(await ask(`${question} [y/n]`, fallback ? 'y' : 'n'));

  return { ask, list, choose, pick, confirm, close: () => readline.close() };
}
