// The dialog's words in the languages ondocs ships, for the Starlight plugin to give a locale in
// one of them: French, German and Spanish, with English, its defaults, for an English locale on a
// site whose root is in another language. A site's own labels, in `dialog.labels` and
// `dialog.locales`, go over these.
import type { OndocsDialogOptions } from '../integration';

/**
 * The labels with an English default, but `title`, which names the site: not the endpoint's own
 * words, which show as it sends them.
 */
export type TranslatedLabels = Omit<
  Required<NonNullable<OndocsDialogOptions['labels']>>,
  'title' | 'noAnswer' | 'rateLimited' | 'budgetExceeded' | 'serverError' | 'answerFailed'
>;

export interface Translation {
  labels: TranslatedLabels;
  /** The dialog's title, `{site}` the site's title: "Ask {site}". */
  title: string;
  /** The ask route's answer when nothing is relevant, `{site}` the site's title. */
  noAnswer: string;
}

/** The dialog's defaults (DEFAULT_LABELS in src/react/labels.ts), and the ask handler's. */
export const ENGLISH: Translation = {
  labels: {
    launcher: 'Ask AI',
    controlKey: 'Ctrl',
    description:
      'Type a question and press Enter. Answers are generated from this site’s pages and cite them.',
    placeholder: 'Ask a question…',
    ask: 'Ask',
    followUp: 'Follow up',
    suggested: 'Suggested',
    list: 'Suggestions',
    stop: 'Stop',
    escapeKey: 'esc',
    close: 'Close',
    footer: 'Answers come from this site and can be wrong. Check the sources.',
    footerNoSources: 'Answers come from this site and can be wrong.',
    footerAsk: 'ask',
    footerClose: 'close',
    poweredBy: 'Answers by {ondocs}.',
    searching: 'Searching the site…',
    writing: 'Writing an answer…',
    noAnswerFound: 'No answer found on this site.',
    answerReadyOne: 'Answer ready, citing 1 source.',
    answerReadyMany: 'Answer ready, citing {count} sources.',
    answerTruncated: 'Answer ready, but cut short at its length limit.',
    truncatedNotice: 'This answer reached its length limit and may be incomplete.',
    retry: 'Retry',
    sources: 'Sources',
    citation: 'Source {n}: {title}',
    source: 'Source {n}:',
    sourceCited: 'Source {n}, cited:',
    sourceNotCited: 'Source {n}, not cited:',
    newQuestion: 'New question',
    helpfulQuestion: 'Was this helpful?',
    helpful: 'Yes, it helped',
    notHelpful: 'No, it did not help',
    thanks: 'Thanks for the feedback.',
    addComment: 'Add a comment',
    comment: 'Comment',
    commentPlaceholder: 'What was missing or wrong?',
    send: 'Send',
    thanksComment: 'Thanks for the comment.',
    feedbackFailed: 'The feedback could not be sent.',
    errorNetwork: 'Could not reach the server. Check your connection.',
    errorUnavailable: 'Answers aren’t available here right now.',
    errorNoBody: 'The response had no body.',
    errorInterrupted: 'The answer was interrupted. Please try again.',
    errorCutOff: 'The answer was cut off. Please try again.',
    errorMisconfigured: 'Answers aren’t set up on this site yet.',
    challengeRequired:
      'The check that you’re not a bot didn’t load. Reload the page and try again.',
    challengeFailed: 'The check that you’re not a bot failed. Please try again.',
    errorUnknown: 'Something went wrong.',
  },
  title: 'Ask {site}',
  noAnswer: "I don't know. I couldn't find anything about that on {site}.",
};

/** By language subtag, as in Starlight's `lang`: `fr` for `fr` and `fr-CA`. */
export const TRANSLATIONS: Readonly<Record<string, Translation>> = {
  en: ENGLISH,
  fr: {
    labels: {
      launcher: 'Demander à l’IA',
      controlKey: 'Ctrl',
      description:
        'Saisissez une question et appuyez sur Entrée. Les réponses sont générées à partir des pages de ce site, qu’elles citent.',
      placeholder: 'Posez une question…',
      ask: 'Demander',
      followUp: 'Poursuivre',
      suggested: 'Questions suggérées',
      list: 'Suggestions',
      stop: 'Arrêter',
      escapeKey: 'esc',
      close: 'Fermer',
      footer: 'Les réponses proviennent de ce site et peuvent être erronées. Vérifiez les sources.',
      footerNoSources: 'Les réponses proviennent de ce site et peuvent être erronées.',
      footerAsk: 'demander',
      footerClose: 'fermer',
      poweredBy: 'Réponses fournies par {ondocs}.',
      searching: 'Recherche dans le site…',
      writing: 'Rédaction de la réponse…',
      noAnswerFound: 'Aucune réponse trouvée sur ce site.',
      answerReadyOne: 'Réponse prête, avec 1 source citée.',
      answerReadyMany: 'Réponse prête, avec {count} sources citées.',
      answerTruncated: 'Réponse prête, mais coupée à sa longueur maximale.',
      truncatedNotice: 'Cette réponse a atteint sa longueur maximale et peut être incomplète.',
      retry: 'Réessayer',
      sources: 'Sources',
      citation: 'Source {n} : {title}',
      source: 'Source {n} :',
      sourceCited: 'Source {n}, citée :',
      sourceNotCited: 'Source {n}, non citée :',
      newQuestion: 'Nouvelle question',
      helpfulQuestion: 'Cette réponse vous a-t-elle été utile ?',
      helpful: 'Oui, elle a été utile',
      notHelpful: 'Non, elle n’a pas été utile',
      thanks: 'Merci pour votre retour.',
      addComment: 'Ajouter un commentaire',
      comment: 'Commentaire',
      commentPlaceholder: 'Qu’est-ce qui manquait ou était inexact ?',
      send: 'Envoyer',
      thanksComment: 'Merci pour votre commentaire.',
      feedbackFailed: 'Votre retour n’a pas pu être envoyé.',
      errorNetwork: 'Impossible de joindre le serveur. Vérifiez votre connexion.',
      errorUnavailable: 'Les réponses ne sont pas disponibles ici pour le moment.',
      errorNoBody: 'La réponse du serveur était vide.',
      errorInterrupted: 'La réponse a été interrompue. Veuillez réessayer.',
      errorCutOff: 'La réponse a été coupée. Veuillez réessayer.',
      errorMisconfigured: 'Les réponses ne sont pas encore configurées sur ce site.',
      challengeRequired:
        'La vérification anti-robot ne s’est pas chargée. Rechargez la page et réessayez.',
      challengeFailed: 'La vérification anti-robot a échoué. Veuillez réessayer.',
      errorUnknown: 'Une erreur s’est produite.',
    },
    title: 'Demander à {site}',
    noAnswer: 'Je ne sais pas. Je n’ai rien trouvé à ce sujet sur {site}.',
  },
  de: {
    labels: {
      launcher: 'KI fragen',
      controlKey: 'Strg',
      description:
        'Gib eine Frage ein und drücke die Eingabetaste. Die Antworten entstehen aus den Seiten dieser Website und nennen sie als Quellen.',
      placeholder: 'Stell eine Frage…',
      ask: 'Fragen',
      followUp: 'Nachfragen',
      suggested: 'Vorschläge',
      list: 'Vorschläge',
      stop: 'Stopp',
      escapeKey: 'esc',
      close: 'Schließen',
      footer: 'Die Antworten stammen von dieser Website und können falsch sein. Prüfe die Quellen.',
      footerNoSources: 'Die Antworten stammen von dieser Website und können falsch sein.',
      footerAsk: 'fragen',
      footerClose: 'schließen',
      poweredBy: 'Antworten von {ondocs}.',
      searching: 'Die Website wird durchsucht…',
      writing: 'Die Antwort wird geschrieben…',
      noAnswerFound: 'Keine Antwort auf dieser Website gefunden.',
      answerReadyOne: 'Antwort fertig, mit 1 zitierten Quelle.',
      answerReadyMany: 'Antwort fertig, mit {count} zitierten Quellen.',
      answerTruncated: 'Antwort fertig, aber an ihrer Längengrenze abgeschnitten.',
      truncatedNotice:
        'Diese Antwort hat ihre Längengrenze erreicht und ist vielleicht unvollständig.',
      retry: 'Erneut versuchen',
      sources: 'Quellen',
      citation: 'Quelle {n}: {title}',
      source: 'Quelle {n}:',
      sourceCited: 'Quelle {n}, zitiert:',
      sourceNotCited: 'Quelle {n}, nicht zitiert:',
      newQuestion: 'Neue Frage',
      helpfulQuestion: 'War das hilfreich?',
      helpful: 'Ja, das hat geholfen',
      notHelpful: 'Nein, das hat nicht geholfen',
      thanks: 'Danke für dein Feedback.',
      addComment: 'Kommentar hinzufügen',
      comment: 'Kommentar',
      commentPlaceholder: 'Was hat gefehlt oder war falsch?',
      send: 'Senden',
      thanksComment: 'Danke für deinen Kommentar.',
      feedbackFailed: 'Das Feedback konnte nicht gesendet werden.',
      errorNetwork: 'Der Server ist nicht erreichbar. Prüfe deine Verbindung.',
      errorUnavailable: 'Antworten sind hier gerade nicht verfügbar.',
      errorNoBody: 'Die Antwort des Servers war leer.',
      errorInterrupted: 'Die Antwort wurde unterbrochen. Bitte versuche es noch einmal.',
      errorCutOff: 'Die Antwort wurde abgeschnitten. Bitte versuche es noch einmal.',
      errorMisconfigured: 'Antworten sind auf dieser Website noch nicht eingerichtet.',
      challengeRequired:
        'Die Prüfung, ob du kein Bot bist, wurde nicht geladen. Lade die Seite neu und versuche es noch einmal.',
      challengeFailed:
        'Die Prüfung, ob du kein Bot bist, ist fehlgeschlagen. Bitte versuche es noch einmal.',
      errorUnknown: 'Etwas ist schiefgelaufen.',
    },
    title: '{site} fragen',
    noAnswer: 'Das weiß ich nicht. Ich habe auf {site} nichts dazu gefunden.',
  },
  es: {
    labels: {
      launcher: 'Preguntar a la IA',
      controlKey: 'Ctrl',
      description:
        'Escribe una pregunta y pulsa Intro. Las respuestas se generan a partir de las páginas de este sitio y las citan.',
      placeholder: 'Haz una pregunta…',
      ask: 'Preguntar',
      followUp: 'Continuar',
      suggested: 'Sugerencias',
      list: 'Sugerencias',
      stop: 'Detener',
      escapeKey: 'esc',
      close: 'Cerrar',
      footer:
        'Las respuestas provienen de este sitio y pueden contener errores. Comprueba las fuentes.',
      footerNoSources: 'Las respuestas provienen de este sitio y pueden contener errores.',
      footerAsk: 'preguntar',
      footerClose: 'cerrar',
      poweredBy: 'Respuestas de {ondocs}.',
      searching: 'Buscando en el sitio…',
      writing: 'Escribiendo una respuesta…',
      noAnswerFound: 'No se encontró ninguna respuesta en este sitio.',
      answerReadyOne: 'Respuesta lista, con 1 fuente citada.',
      answerReadyMany: 'Respuesta lista, con {count} fuentes citadas.',
      answerTruncated: 'Respuesta lista, pero cortada al llegar a su límite de longitud.',
      truncatedNotice: 'Esta respuesta llegó a su límite de longitud y puede estar incompleta.',
      retry: 'Reintentar',
      sources: 'Fuentes',
      citation: 'Fuente {n}: {title}',
      source: 'Fuente {n}:',
      sourceCited: 'Fuente {n}, citada:',
      sourceNotCited: 'Fuente {n}, no citada:',
      newQuestion: 'Nueva pregunta',
      helpfulQuestion: '¿Te resultó útil?',
      helpful: 'Sí, me ayudó',
      notHelpful: 'No, no me ayudó',
      thanks: 'Gracias por tu opinión.',
      addComment: 'Añadir un comentario',
      comment: 'Comentario',
      commentPlaceholder: '¿Qué faltaba o qué estaba mal?',
      send: 'Enviar',
      thanksComment: 'Gracias por tu comentario.',
      feedbackFailed: 'No se pudo enviar tu opinión.',
      errorNetwork: 'No se pudo conectar con el servidor. Comprueba tu conexión.',
      errorUnavailable: 'Las respuestas no están disponibles aquí en este momento.',
      errorNoBody: 'La respuesta del servidor llegó vacía.',
      errorInterrupted: 'La respuesta se interrumpió. Inténtalo de nuevo.',
      errorCutOff: 'La respuesta se cortó. Inténtalo de nuevo.',
      errorMisconfigured: 'Las respuestas aún no están configuradas en este sitio.',
      challengeRequired:
        'La comprobación de que no eres un bot no se cargó. Recarga la página e inténtalo de nuevo.',
      challengeFailed: 'La comprobación de que no eres un bot falló. Inténtalo de nuevo.',
      errorUnknown: 'Algo salió mal.',
    },
    title: 'Preguntar a {site}',
    noAnswer: 'No lo sé. No encontré nada sobre eso en {site}.',
  },
};

/**
 * The words for a language tag, by its language subtag (`fr-CA` gets French), or `undefined`
 * for a language ondocs has none in.
 */
export function translation(lang: string | undefined): Translation | undefined {
  const language = lang?.split('-')[0]?.toLowerCase();
  return language && Object.hasOwn(TRANSLATIONS, language) ? TRANSLATIONS[language] : undefined;
}
