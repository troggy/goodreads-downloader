import { writeFile, readFile, mkdir, stat } from "fs/promises";
import { createWriteStream } from "fs";
import fetch from "node-fetch";
import { pipeline } from "stream";
import { compareTwoStrings } from "string-similarity";

const dataFile = process.argv[2] || "data.csv";

const data = (await readFile(dataFile, { encoding: "utf8" })).split("\n");

const headers = data[0].split(",");
const ISBN = headers.findIndex((h) => h === "ISBN");
const ISBN13 = headers.findIndex((h) => h === "ISBN13");
const Title = headers.findIndex((h) => h === "Title");
const Author = headers.findIndex((h) => h === "Author");
const Bookshelves = headers.findIndex((h) => h === "Bookshelves");

await mkdir("./out", { recursive: true });

const storeExists = await stat(`.store.json`)
.then((v) => true)
.catch((e) => false);

let store = {}
if (storeExists) {
  store = JSON.parse(await readFile(`.store.json`, { encoding: "utf8" }));
}

type Book = {
  authors: string[];
  title: string;
  format: string;
  link: string;
};

const flibustaRequests = [];
const flibustaResults = [];
let finished = false;

const flibustaLoop = async () => {
  const status = () => {};
  const nextCycle = async () => {
    if (flibustaRequests.length > 0) {
      const { id, title, author } = flibustaRequests.pop();
      const books = await searchFlibusta(title);
      const [book] = matchingTitle(title, books);
      if (book) {
        const result = await downloadBook(
          book.link,
          status,
          `${book.authors[0]} - ${book.title}.epub`
        );
        if (result) {
          store[id] = { title, author, source: 'flibusta' }
          await writeFile(`.store.json`, JSON.stringify(store, null, 2))
        }
        flibustaResults.push({
          title,
          result: result ? "ok" : "failed to download",
        });
      } else {
        flibustaResults.push({
          title,
          result: "not found",
        });
      }
    }
    if (!finished || flibustaRequests.length > 0) {
      setTimeout(nextCycle, 5000 + 15000 * Math.random());
    } else {
      console.log("Flibusta checks:");
      console.log(
        flibustaResults.forEach(({ title, result }) => {
          console.log(`${result === 'ok' ? '✅' : '🛑'} ${title}: ${result}`);
        })
      );
    }
  };

  nextCycle();
};

flibustaLoop();

const translate = (text: string, source: string, target: string) =>
  fetch("https://libretranslate.com/translate", {
    method: "POST",
    body: JSON.stringify({
      q: text,
      source,
      target,
      format: "text",
    }),
    headers: { "Content-Type": "application/json" },
  }).then((res) => res.json());

const searchFlibusta = async (title: string) => {
  const searchResults = await fetch(
    `http://flibusta.is/booksearch?ask=${title}&chb=on`
  ).then((res) => res.text());

  const bookMatches = searchResults.matchAll(
    /<li><a href="(?<link>.+?)">(<b>|<span style="background-color: #FFFCBB">)(?<title>.+?)<\/(span|b)><\/a> - <a href=".+?">(?<author>.+?)<\/a><\/li>/gm
  );

  const books = [];
  for (const match of bookMatches) {
    const { author, title, link } = match.groups;
    books.push({
      authors: [author.replaceAll(/<.+?\/?>/g, "")],
      title: title.replaceAll(/<.+?\/?>/g, ""),
      format: "epub",
      link: `http://flibusta.is${link}/epub`,
    });
  }
  return books;
};

const searchLibGen = async (needle, term): Promise<Book[]> => {
  const searchResults = await fetch(
    `https://libgen.is/search.php?req=${needle}&lg_topic=libgen&open=0&view=simple&res=100&phrase=1&column=${term}`
  ).then((res) => res.text());

  const bookMatches = searchResults.matchAll(
    /<tr valign=top bgcolor=.*?><td>.+?<\/td>(\s|\n)+?<td><a.+?author["']>\s*(?<author1>.+?)<\/a>([;,]<a.+?>\s*(?<author2>.+?)<\/a>)?([;,]<a.+?>\s*(?<author3>.+?)<\/a>)?([;,]<a.+?>\s*(?<author4>.+?)<\/a>)?<\/td>(\s|\n)+?<td.+?title='' id=\d+>(?<title>.+?)\s*(<\/a>|<br>|<font face=Times color=green>).*?<\/td>(\s|\n)+?(<td.+?<\/td>(\s|\n)+){5}<td.+?>(?<format>.+?)<\/td>(\s|\n)+?<td><a href='(?<link>http:\/\/library\.lol\/main\/.+?)'/gm
  );

  const books = [];
  for (const match of bookMatches) {
    const { author1, author2, author3, author4, title, format, link } =
      match.groups;
    books.push({
      authors: [author1, author2, author3, author4].map((a) => !!a),
      title,
      format,
      link,
    });
  }
  return books;
};

const downloadFromLibgen = async (pageLink, status) => {
  const link = await getLibgenDownloadLink(pageLink);
  return downloadBook(link, status);
};

const getLibgenDownloadLink = async (pageLink) => {
  const downloadPage = await fetch(pageLink).then((res) => res.text());
  const downloadUrl = downloadPage.match(
    /<div id="download">[\s\t]*<h2><a href="(.+?)"/
  );
  if (!downloadUrl || downloadUrl.length < 1) return;

  return downloadUrl[1];
};

const downloadBook = async (fileLink, status, fileTitle?: string) => {
  const title =
    fileTitle || decodeURIComponent(fileLink.split("/").slice(-1)[0]);
  status(`Downloading ${title}`);

  const exists = await stat(`./out/${title}`)
    .then((v) => true)
    .catch((e) => false);
  if (exists) {
    status(`${title}`, true, true);
    return true;
  }
  const response = await fetch(fileLink).catch(e => {
    return { ok: false, body: '' }
  });

  if (!response.ok) {
    status("failed", false, true);
      return false;
  }

  await new Promise((resolve, reject) =>
    pipeline(response.body, createWriteStream(`./out/${title}`), (err) =>
      err ? reject(err) : resolve(null)
    )
  );

  return stat(`./out/${title}`)
    .then((v) => {
      status(`${title}`, true, true);
      return true;
    })
    .catch((e) => {
      status("failed", false, true);
      return false;
    });
};

const n = (str: string) => str.toLowerCase().replace(/[,-;—!?.]/g, "");

const report =
  (base: string) => (str: string, status?: true | false | 'deferred', final?: boolean) =>
    final
      ? console.log(
          `\r${status === true ? "✅" : !status ? "🔴" : "🕐"} ${base}.. ${str.padEnd(40, " ")}`
        )
      : process.stdout.write(`\r${base}.. ${str.padEnd(40, " ")}`);

const matchingTitle = (title1: string, books: Book[]) =>
  books.filter(
    ({ title }) =>
      n(title1) === n(title) || compareTwoStrings(title1, title) > 0.8
  );

const matchingFormat = (books: Book[]) =>
  books.find(({ format }) => format === "epub") ||
  books.find(({ format }) => format === "mobi") ||
  books.find(({ format }) => format === "pdf");

const getBestMatch = (title1: string, books: Book[]) =>
  matchingFormat(matchingTitle(title1, books));

for (let i = 1; i < data.length; i++) {
  const bookData = data[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
  let status = report(bookData[Title]);
  if(store[bookData[0]] || !bookData[Bookshelves].includes('to-read')) continue;

  status("Trying by ISBN");
  let book = matchingFormat(
    await searchLibGen(
      bookData[ISBN].replace('"=""', "").replace('"""', ""),
      "identifier"
    )
  );

  if (!book) {
    status("Trying by ISBN13");
    book = matchingFormat(
      await searchLibGen(
        bookData[ISBN13].replace('"=""', "").replace('"""', ""),
        "identifier"
      )
    );
  }

  if (!book) {
    status("Trying by Title + Author");
    book = getBestMatch(
      bookData[Title],
      await searchLibGen(bookData[Title] + " " + bookData[Author], "def")
    );
  }

  if (!book) {
    status("Trying by Title");
    book = getBestMatch(
      bookData[Title],
      await searchLibGen(bookData[Title], "def")
    );
  }

  if (!book) {
    status("Trying by Title + Author translated");
    book = getBestMatch(
      bookData[Title],
      await searchLibGen(
        bookData[Title] + " " + translate(bookData[Author], "en", "ru"),
        "def"
      )
    );
  }

  if (book) {
    const res = await downloadFromLibgen(book.link, status);
    if (res) {
      store[bookData[0]] = { title: bookData[Title], author: bookData[Author], source: 'libgen.is' }
      await writeFile(`.store.json`, JSON.stringify(store, null, 2))
    }
  } else {
    status("Scheduled check on Flibusta", 'deferred', true);
    flibustaRequests.push({ id: bookData[0], title: bookData[Title], author: bookData[Author] });
  }
}
finished = true;
console.log("Waiting for flibusta checks to finish...");
while (flibustaRequests.length > 0) {
  process.stdout.write(`\rRequests: ${flibustaRequests.length}`);
  await new Promise((resolve) => setTimeout(resolve, 10000));
}
