# Goodreads bulk downloader

NOTE: this software is for educational purposes only. Don't use it to download any copyrighted books.

Given the exported list of books from Goodreads downloads a ebook file. Tries to get book from libgen first, falls back to Flibusta if not found. Tries epub format first, falls back to pdf and mobi if not found


## Usage

1. Export your book list from Goodreads: https://www.goodreads.com/review/import

2. Run script
```
yarn start <your file csv>
```

Notes:
The software is very rough and experimental. It will take some time to process the list especially for Flibusta downloads since those are throttled a little (run with a delay). You can interrupt process at any point and resume later, the script will skip already downloaded books. If you want to redownload everything again, remove `.store.json` file. Downloaded books are in the `out` folder.


