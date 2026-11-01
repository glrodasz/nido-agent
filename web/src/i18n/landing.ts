// The landing page's copy in each language. **bold** and *emphasis* are rendered by Landing.tsx.
// Demo picks are examples, not live data; titles use each language's release name.
import type { Locale } from "./locale";

export type Pick = {
  title: string;
  year: string;
  kind: "movie" | "series";
  minutes: number;
  genres: string;
  service: [name: string, brand: string];
  imdb: number;
  fit: boolean;
  why?: string;
  poster: string;
};

export type Scene = { chip: string; question: string; reply: string; picks: Pick[] };

const en = {
  demoLabel: "Example search in Nido",
  askLikeYouTalk: "Ask the way you talk",
  example: "Example",
  askButton: "Ask",
  otherExamples: "Other examples",
  movie: "Movie",
  series: "Series",
  fit: "Good for all of you",
  grownUp: "Best with a grown-up",
  demoNote: "Example for a family with a 4-year-old.",
  scenes: [
    {
      chip: "Fun sci-fi",
      question: "A fun science fiction movie",
      reply:
        "Two you'll all enjoy. **WALL·E** is perfect for your 4-year-old; **The Mitchells vs. the Machines** is wilder and better watched together.",
      picks: [
        { title: "WALL·E", year: "2008", kind: "movie", minutes: 98, genres: "Animation, Science Fiction", service: ["Disney+", "#113ccf"], imdb: 8.4, fit: true, poster: "#c9a46a, #6b4a2b" },
        { title: "The Mitchells vs. the Machines", year: "2021", kind: "movie", minutes: 114, genres: "Animation, Comedy", service: ["Netflix", "#e50914"], imdb: 7.6, fit: false, why: "Rated 7+ and your child is 4", poster: "#b18be0, #4b2a86" },
      ],
    },
    {
      chip: "Animated and well rated",
      question: "Something animated and well rated, under 90 minutes",
      reply:
        "**My Neighbor Totoro** is calm and beautiful for the little ones. **Shaun the Sheep Movie** has no dialogue and makes every age laugh.",
      picks: [
        { title: "My Neighbor Totoro", year: "1988", kind: "movie", minutes: 86, genres: "Animation, Fantasy", service: ["HBO Max", "#5b2bd6"], imdb: 8.1, fit: true, poster: "#9cc79a, #3b6e47" },
        { title: "Shaun the Sheep Movie", year: "2015", kind: "movie", minutes: 85, genres: "Animation, Comedy", service: ["Netflix", "#e50914"], imdb: 7.3, fit: true, why: "A few mildly tense moments", poster: "#d8c79a, #7b6a3a" },
      ],
    },
    {
      chip: "A series that isn't scary",
      question: "A series with short episodes that isn't scary",
      reply:
        "**Bluey** is many parents' favourite: 7-minute episodes and lots of humour. **Puffin Rock** is calmer, ideal before bed.",
      picks: [
        { title: "Bluey", year: "2018–", kind: "series", minutes: 7, genres: "Animation, Family", service: ["Disney+", "#113ccf"], imdb: 9.3, fit: true, poster: "#8fb6c9, #2f6280" },
        { title: "Puffin Rock", year: "2015–2022", kind: "series", minutes: 7, genres: "Animation, Kids", service: ["Netflix", "#e50914"], imdb: 8.0, fit: true, poster: "#a6c9b8, #3f6f63" },
      ],
    },
  ] as Scene[],
  marks: ["Seen", "We liked it", "Our kid liked it", "On repeat"],
  kicker: "For family movie night",
  heroTitle: "Tired of not knowing what to watch, or what's *right* for your kids?",
  heroLede:
    "Nido searches the streaming services you already pay for and suggests movies and series **that suit your kids and that you'll enjoy too**. Tell it your child's age and what you'd rather avoid, and Nido does the rest.",
  signIn: "Sign in with Google",
  seeWhat: "See what Nido does",
  fine: "Free, with a daily search limit per family.",
  bandTitle: "Suitable isn't enough. Everyone has to enjoy it.",
  bandP1:
    "Most kids' finders only filter. Nido starts from your family: **your child's age, the services you already have and what you'd rather avoid**, like scares, violence or bad examples.",
  bandP2:
    "With that it looks for quality titles, well rated and that a grown-up enjoys too, and tells you in one line whether they suit you and why.",
  triad: ["Right for their age", "Well rated", "On your services", "Fun for everyone"],
  featuresTitle: "Everything you need to decide in a minute",
  featuresLede: "Every fact comes from an official source and says where it comes from.",
  ageEyebrow: "Age",
  ageTitle: "The world's age ratings, in a single number",
  ageBody:
    "Nido gathers the official ratings of nine countries, yours included, and works out a recommended age. If you want the detail, you get it country by country, next to links to Common Sense Media and the IMDb Parents Guide.",
  ageExample: "The Mitchells vs. the Machines",
  ageVerdict: "Nido's recommended age. Your child is 4, so it warns you: **better watched with a grown-up**.",
  whereEyebrow: "Where to watch",
  whereTitle: "Only what you can watch today, on what you already pay for",
  whereBody:
    "Pick your services once. Nido puts what's included in your subscription first, with a button that opens it directly, and keeps rent-or-buy titles apart.",
  included: "Included",
  rental: "Apple TV · Rent",
  notYours: "Not on your services",
  memoriesEyebrow: "Family memories",
  memoriesTitle: "Note what you loved and what they want again",
  memoriesBody:
    "Mark whether you've seen it, whether you or your child liked it, and the ones they ask for again and again. The repeats stay at hand for those nights when only their favourite will do.",
  bluey: "2018– · Series · Animation, Family",
  laterEyebrow: "For later",
  laterTitle: "Hide it until they're old enough",
  laterBody:
    "A movie that isn't for their age yet? Ask Nido not to suggest it until your child reaches the age you choose, or ever. It comes back on its own when you update their age, and you can always undo it.",
  spirited: "Spirited Away",
  spiritedMeta: "2001 · Movie · 125 min",
  untilBefore: "Until they're",
  untilAfter: "",
  anyAge: "At any age",
  hide: "Hide",
  cancel: "Cancel",
  agentEyebrow: "An AI agent",
  agentTitle: "AI suggests, data decides",
  agentBody:
    "Nido is an agent: it understands what you ask, searches the catalog, checks ages, scores and availability, and explains its choice. Your family's rules are applied with data, not guesses, so what you hide never shows up again.",
  trace: [
    ["Understands", "\"something fun and sci-fi, for tonight\""],
    ["Searches", "your country's catalog and your services"],
    ["Checks", "age, what you avoid and what you hid"],
    ["Explains", "in one line why it suits you"],
  ] as [string, string][],
  howTitle: "How it works",
  steps: [
    ["Tell it about your family", "Your child's age, your services and what you'd rather avoid. You can invite your partner to share everything."],
    ["Ask or browse", "Write whatever you feel like, or use shortcuts like \"under 90 minutes\" or \"animated\"."],
    ["Pick and press play", "Each card tells you whether it suits you, the score and where to watch. One tap and it starts."],
  ] as [string, string][],
  closingTitle: "Less time choosing, more time together.",
  closingBody: "Sign in with your Google account and set up your family's profile in a minute.",
  footerSources: "Availability from JustWatch via TMDB. Ratings from OMDb.",
  footerTag: "Nido · homemade for family viewing",
};

export type LandingCopy = typeof en;

const es: LandingCopy = {
  demoLabel: "Ejemplo de búsqueda en Nido",
  askLikeYouTalk: "Pregunta como hablas",
  example: "Ejemplo",
  askButton: "Preguntar",
  otherExamples: "Otros ejemplos",
  movie: "Película",
  series: "Serie",
  fit: "Buena para todos",
  grownUp: "Mejor con un adulto",
  demoNote: "Ejemplo para una familia con un niño de 4 años.",
  scenes: [
    {
      chip: "Ciencia ficción divertida",
      question: "Una película divertida de ciencia ficción",
      reply:
        "Dos que les van a gustar a todos. **WALL·E** es perfecta para tu hijo de 4; **Los Mitchell** es más alocada y conviene verla juntos.",
      picks: [
        { title: "WALL·E", year: "2008", kind: "movie", minutes: 98, genres: "Animación, Ciencia ficción", service: ["Disney+", "#113ccf"], imdb: 8.4, fit: true, poster: "#c9a46a, #6b4a2b" },
        { title: "Los Mitchell vs. las máquinas", year: "2021", kind: "movie", minutes: 114, genres: "Animación, Comedia", service: ["Netflix", "#e50914"], imdb: 7.6, fit: false, why: "Clasificada 7+ y tu hijo tiene 4", poster: "#b18be0, #4b2a86" },
      ],
    },
    {
      chip: "Animada y bien valorada",
      question: "Algo animado y bien valorado, menos de 90 minutos",
      reply:
        "**Mi vecino Totoro** es tranquila y hermosa para los más chiquitos. **Shaun, el cordero** no tiene diálogos y hace reír a cualquier edad.",
      picks: [
        { title: "Mi vecino Totoro", year: "1988", kind: "movie", minutes: 86, genres: "Animación, Fantasía", service: ["HBO Max", "#5b2bd6"], imdb: 8.1, fit: true, poster: "#9cc79a, #3b6e47" },
        { title: "Shaun, el cordero: La película", year: "2015", kind: "movie", minutes: 85, genres: "Animación, Comedia", service: ["Netflix", "#e50914"], imdb: 7.3, fit: true, why: "Algún momento de tensión leve", poster: "#d8c79a, #7b6a3a" },
      ],
    },
    {
      chip: "Una serie que no dé miedo",
      question: "Una serie con capítulos cortos que no dé miedo",
      reply:
        "**Bluey** es la favorita de muchos padres: capítulos de 7 minutos y mucho humor. **Puffin Rock** es más calmada, ideal antes de dormir.",
      picks: [
        { title: "Bluey", year: "2018–", kind: "series", minutes: 7, genres: "Animación, Familia", service: ["Disney+", "#113ccf"], imdb: 9.3, fit: true, poster: "#8fb6c9, #2f6280" },
        { title: "Puffin Rock", year: "2015–2022", kind: "series", minutes: 7, genres: "Animación, Infantil", service: ["Netflix", "#e50914"], imdb: 8.0, fit: true, poster: "#a6c9b8, #3f6f63" },
      ],
    },
  ],
  marks: ["Vista", "Nos gustó", "Le gustó a mi hijo", "Para repetir"],
  kicker: "Para ver en familia",
  heroTitle: "¿Cansado de no saber qué ver, ni qué es *adecuado* para tus hijos?",
  heroLede:
    "Nido busca en los servicios de streaming que ya pagas y te propone películas y series **aptas para tus hijos y que también vas a disfrutar tú**. Le dices la edad de tu hijo y lo que prefieres evitar, y Nido hace el resto.",
  signIn: "Entrar con Google",
  seeWhat: "Ver qué hace Nido",
  fine: "Gratis, con un límite diario de búsquedas por familia.",
  bandTitle: "Que sea apta no basta. Tiene que gustarles a todos.",
  bandP1:
    "La mayoría de buscadores para niños solo filtran. Nido parte de tu familia: **la edad de tu hijo, los servicios que ya tienen y lo que prefieres evitar**, como sustos, violencia o malos ejemplos.",
  bandP2:
    "Con eso busca títulos de calidad, bien valorados y que un adulto también vea con gusto, y te dice en una línea si encajan con ustedes y por qué.",
  triad: ["Apta para su edad", "Bien valorada", "En tus servicios", "Divertida para todos"],
  featuresTitle: "Todo lo que necesitas para decidir en un minuto",
  featuresLede: "Cada dato viene de una fuente oficial y te dice de dónde sale.",
  ageEyebrow: "Edad",
  ageTitle: "Las clasificaciones de edad del mundo, en una sola cifra",
  ageBody:
    "Nido junta las clasificaciones oficiales de nueve países, incluida la de tu país, y calcula una edad recomendada. Si quieres el detalle, lo tienes país por país, junto a enlaces a Common Sense Media y la guía para padres de IMDb.",
  ageExample: "Los Mitchell vs. las máquinas",
  ageVerdict: "Edad recomendada por Nido. Tu hijo tiene 4, así que te avisa: **mejor verla con un adulto**.",
  whereEyebrow: "Dónde verla",
  whereTitle: "Solo lo que puedes ver hoy, en lo que ya pagas",
  whereBody:
    "Marca tus servicios una vez. Nido te pone primero lo que está incluido en tu suscripción, con un botón para abrirlo directamente, y separa lo que solo se puede alquilar o comprar.",
  included: "Incluida",
  rental: "Apple TV · Alquiler",
  notYours: "No está en tus servicios",
  memoriesEyebrow: "Recuerdos de familia",
  memoriesTitle: "Anota lo que les gustó y lo que quieren repetir",
  memoriesBody:
    "Marca si ya la vieron, si les gustó a ustedes o a tu hijo, y las que pide una y otra vez. Las de repetir quedan a la mano para esas noches en que solo sirve su favorita.",
  bluey: "2018– · Serie · Animación, Familia",
  laterEyebrow: "Para más adelante",
  laterTitle: "Escóndela hasta que tenga edad",
  laterBody:
    "¿Una película que todavía no es para su edad? Pídele a Nido que no la sugiera hasta que tu hijo cumpla la edad que elijas, o nunca. Vuelve sola cuando actualizas su edad, y siempre puedes deshacerlo.",
  spirited: "El viaje de Chihiro",
  spiritedMeta: "2001 · Película · 125 min",
  untilBefore: "Hasta que tenga",
  untilAfter: "años",
  anyAge: "A cualquier edad",
  hide: "Ocultar",
  cancel: "Cancelar",
  agentEyebrow: "Un agente de IA",
  agentTitle: "La IA propone, los datos deciden",
  agentBody:
    "Nido es un agente: entiende lo que pides, busca en el catálogo, consulta edades, notas y disponibilidad, y te explica su elección. Las reglas de tu familia se aplican con datos, no con suposiciones, así que lo que ocultas nunca vuelve a aparecer.",
  trace: [
    ["Entiende", "\"algo divertido de ciencia ficción, para esta noche\""],
    ["Busca", "en el catálogo de tu país y en tus servicios"],
    ["Comprueba", "edad, lo que evitas y lo que ocultaste"],
    ["Explica", "en una línea por qué encaja con ustedes"],
  ],
  howTitle: "Cómo funciona",
  steps: [
    ["Cuéntale de tu familia", "La edad de tu hijo, tus servicios y lo que prefieres evitar. Puedes invitar a tu pareja para compartirlo todo."],
    ["Pregunta o explora", "Escribe lo que se te antoje o usa atajos como \"menos de 90 minutos\" o \"animada\"."],
    ["Elige y dale play", "Cada tarjeta te dice si encaja, la nota y dónde verla. Un toque y empieza."],
  ],
  closingTitle: "Menos tiempo eligiendo, más tiempo juntos.",
  closingBody: "Entra con tu cuenta de Google y arma el perfil de tu familia en un minuto.",
  footerSources: "Disponibilidad de JustWatch vía TMDB. Valoraciones de OMDb.",
  footerTag: "Nido · hecho en casa para ver en familia",
};

const pt: LandingCopy = {
  demoLabel: "Exemplo de busca no Nido",
  askLikeYouTalk: "Pergunte do jeito que você fala",
  example: "Exemplo",
  askButton: "Perguntar",
  otherExamples: "Outros exemplos",
  movie: "Filme",
  series: "Série",
  fit: "Boa para todos",
  grownUp: "Melhor com um adulto",
  demoNote: "Exemplo para uma família com uma criança de 4 anos.",
  scenes: [
    {
      chip: "Ficção científica divertida",
      question: "Um filme divertido de ficção científica",
      reply:
        "Dois que todos vão curtir. **WALL·E** é perfeito para o seu filho de 4; **A Família Mitchell** é mais maluco e vale ver juntos.",
      picks: [
        { title: "WALL·E", year: "2008", kind: "movie", minutes: 98, genres: "Animação, Ficção científica", service: ["Disney+", "#113ccf"], imdb: 8.4, fit: true, poster: "#c9a46a, #6b4a2b" },
        { title: "A Família Mitchell e a Revolta das Máquinas", year: "2021", kind: "movie", minutes: 114, genres: "Animação, Comédia", service: ["Netflix", "#e50914"], imdb: 7.6, fit: false, why: "Classificação 7+ e o seu filho tem 4", poster: "#b18be0, #4b2a86" },
      ],
    },
    {
      chip: "Animado e bem avaliado",
      question: "Algo animado e bem avaliado, com menos de 90 minutos",
      reply:
        "**Meu Amigo Totoro** é tranquilo e lindo para os pequenos. **Shaun, o Carneiro** não tem diálogos e faz rir em qualquer idade.",
      picks: [
        { title: "Meu Amigo Totoro", year: "1988", kind: "movie", minutes: 86, genres: "Animação, Fantasia", service: ["HBO Max", "#5b2bd6"], imdb: 8.1, fit: true, poster: "#9cc79a, #3b6e47" },
        { title: "Shaun, o Carneiro: O Filme", year: "2015", kind: "movie", minutes: 85, genres: "Animação, Comédia", service: ["Netflix", "#e50914"], imdb: 7.3, fit: true, why: "Alguns momentos de leve tensão", poster: "#d8c79a, #7b6a3a" },
      ],
    },
    {
      chip: "Uma série que não dê medo",
      question: "Uma série com episódios curtos que não dê medo",
      reply:
        "**Bluey** é a favorita de muitos pais: episódios de 7 minutos e muito humor. **Puffin Rock** é mais calma, ideal antes de dormir.",
      picks: [
        { title: "Bluey", year: "2018–", kind: "series", minutes: 7, genres: "Animação, Família", service: ["Disney+", "#113ccf"], imdb: 9.3, fit: true, poster: "#8fb6c9, #2f6280" },
        { title: "Puffin Rock", year: "2015–2022", kind: "series", minutes: 7, genres: "Animação, Infantil", service: ["Netflix", "#e50914"], imdb: 8.0, fit: true, poster: "#a6c9b8, #3f6f63" },
      ],
    },
  ],
  marks: ["Visto", "Nós gostamos", "Meu filho gostou", "Para repetir"],
  kicker: "Para assistir em família",
  heroTitle: "Cansado de não saber o que assistir, nem o que é *adequado* para os seus filhos?",
  heroLede:
    "O Nido busca nos serviços de streaming que você já assina e sugere filmes e séries **adequados para os seus filhos e que você também vai curtir**. Diga a idade do seu filho e o que prefere evitar, e o Nido faz o resto.",
  signIn: "Entrar com o Google",
  seeWhat: "Ver o que o Nido faz",
  fine: "Grátis, com um limite diário de buscas por família.",
  bandTitle: "Ser adequado não basta. Todo mundo tem que gostar.",
  bandP1:
    "A maioria dos buscadores para crianças só filtra. O Nido parte da sua família: **a idade do seu filho, os serviços que vocês já têm e o que você prefere evitar**, como sustos, violência ou maus exemplos.",
  bandP2:
    "Com isso, busca títulos de qualidade, bem avaliados e que um adulto também assiste com prazer, e diz em uma linha se combinam com vocês e por quê.",
  triad: ["Adequado para a idade", "Bem avaliado", "Nos seus serviços", "Divertido para todos"],
  featuresTitle: "Tudo o que você precisa para decidir em um minuto",
  featuresLede: "Cada dado vem de uma fonte oficial e diz de onde saiu.",
  ageEyebrow: "Idade",
  ageTitle: "As classificações indicativas do mundo, em um só número",
  ageBody:
    "O Nido junta as classificações oficiais de nove países, incluindo o seu, e calcula uma idade recomendada. Se quiser o detalhe, você tem país por país, ao lado de links para o Common Sense Media e o guia para os pais do IMDb.",
  ageExample: "A Família Mitchell e a Revolta das Máquinas",
  ageVerdict: "Idade recomendada pelo Nido. O seu filho tem 4, então ele avisa: **melhor assistir com um adulto**.",
  whereEyebrow: "Onde assistir",
  whereTitle: "Só o que dá para assistir hoje, no que você já assina",
  whereBody:
    "Marque os seus serviços uma vez. O Nido mostra primeiro o que está incluído na sua assinatura, com um botão para abrir direto, e separa o que só dá para alugar ou comprar.",
  included: "Incluído",
  rental: "Apple TV · Aluguel",
  notYours: "Não está nos seus serviços",
  memoriesEyebrow: "Memórias de família",
  memoriesTitle: "Anote do que gostaram e o que querem repetir",
  memoriesBody:
    "Marque se já assistiram, se vocês ou o seu filho gostaram, e os que ele pede de novo e de novo. Os de repetir ficam à mão para aquelas noites em que só o favorito resolve.",
  bluey: "2018– · Série · Animação, Família",
  laterEyebrow: "Para mais tarde",
  laterTitle: "Esconda até ter idade",
  laterBody:
    "Um filme que ainda não é para a idade dele? Peça ao Nido para não sugerir até o seu filho completar a idade que você escolher, ou nunca. Ele volta sozinho quando você atualiza a idade, e sempre dá para desfazer.",
  spirited: "A Viagem de Chihiro",
  spiritedMeta: "2001 · Filme · 125 min",
  untilBefore: "Até ter",
  untilAfter: "anos",
  anyAge: "Em qualquer idade",
  hide: "Ocultar",
  cancel: "Cancelar",
  agentEyebrow: "Um agente de IA",
  agentTitle: "A IA sugere, os dados decidem",
  agentBody:
    "O Nido é um agente: entende o que você pede, busca no catálogo, consulta idades, notas e disponibilidade, e explica a escolha. As regras da sua família são aplicadas com dados, não com suposições, então o que você esconde nunca volta a aparecer.",
  trace: [
    ["Entende", "\"algo divertido de ficção científica, para hoje à noite\""],
    ["Busca", "no catálogo do seu país e nos seus serviços"],
    ["Confere", "idade, o que você evita e o que escondeu"],
    ["Explica", "em uma linha por que combina com vocês"],
  ],
  howTitle: "Como funciona",
  steps: [
    ["Conte sobre a sua família", "A idade do seu filho, os seus serviços e o que prefere evitar. Você pode convidar seu parceiro ou parceira para compartilhar tudo."],
    ["Pergunte ou explore", "Escreva o que der vontade ou use atalhos como \"menos de 90 minutos\" ou \"animado\"."],
    ["Escolha e dê play", "Cada cartão diz se combina, a nota e onde assistir. Um toque e começa."],
  ],
  closingTitle: "Menos tempo escolhendo, mais tempo juntos.",
  closingBody: "Entre com a sua conta do Google e monte o perfil da sua família em um minuto.",
  footerSources: "Disponibilidade da JustWatch via TMDB. Avaliações do OMDb.",
  footerTag: "Nido · feito em casa para assistir em família",
};

export const LANDING: Record<Locale, LandingCopy> = { es, en, pt };
