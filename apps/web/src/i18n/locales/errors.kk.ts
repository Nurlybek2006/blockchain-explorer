import type { DictionaryShape } from '../types';
import type { errorsEn } from './errors.en';

export const errorsKk = {
  invalidInput: 'Енгізілген мәліметтерді тексеріңіз.',
  sessionExpired: 'Сессия мерзімі аяқталды. Қайта кіріңіз.',
  accessDenied: 'Бұл әрекетті орындауға рұқсатыңыз жоқ.',
  notFound: 'Сұралған дерек табылмады.',
  conflict: 'Бұл элемент бұрыннан бар.',
  tooManyRequests: 'Сұраныстар тым көп. Біраздан кейін қайталап көріңіз.',
  unavailable: 'Қызмет уақытша қолжетімсіз. Кейінірек қайталап көріңіз.',
  unknown: 'Қате орын алды. Қайталап көріңіз.',
  requestFailed: 'Сұранысты орындау мүмкін болмады.',
  invalidResponse: 'Қызметтен күтпеген жауап келді. Қайталап көріңіз.',
  network: 'Қызметке қосылу мүмкін болмады. Байланысты тексеріп, қайталап көріңіз.',
  timeout: 'Сұранысты күту уақыты аяқталды. Қайталап көріңіз.',
  accountChanged: 'Белсенді аккаунт ауысты. Әрекетті қайталап көріңіз.',
  invalidCredentials: 'Электрондық пошта немесе құпиясөз қате.',
  emailExists: 'Бұл электрондық поштаға тіркелген аккаунт бар.',
  bodyTooLarge: 'Жіберілген деректердің көлемі тым үлкен.',
  unsupportedBody: 'Бұл деректер пішіміне қолдау көрсетілмейді.',
} satisfies DictionaryShape<typeof errorsEn>;
