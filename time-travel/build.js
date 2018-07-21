require("dotenv").config();

const fs = require("fs-extra");
const path = require("path");
const fetch = require("node-fetch");
const unzip = require("unzip");

const accessToken = process.env.ACCESS_TOKEN;
const query = `
{
  repository(owner:"Microsoft", name:"join-dev-design"){
    pullRequests(first: 10, states: MERGED) {
      edges {
        node {
          id
          participants(first: 10) {
            edges {
              node {
                name
                avatarUrl
              }
            }
          }
          mergeCommit {
            id
            zipballUrl
          }
          id
        }
      }
    }
  }
}`;

const historyFolderPath = path.resolve(
  __dirname,
  `../docs/time-travel/history`
);

/**
 * TODOS
 * - Flush `./zips` folder.
 * - Flush `../docs/history` folder.
 */

/**
 * getData from github
 * @return {Promise} A Promise that resolves to response
 */
const getDataFromGithub = () =>
  fetch("https://api.github.com/graphql", {
    method: "POST",
    body: JSON.stringify({ query }),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    }
  })
    .then(res => res.json())
    .catch(err => console.error(err));

/**
 * Write github response to a json so the front end can use it later.
 * @param {Object} data
 * @return {Object} same data object
 */
const writeJSONToDocs = data => {
  return new Promise((resolve, reject) => {
    fs.writeFile(
      path.resolve(__dirname, `../docs/time-travel/index.json`),
      JSON.stringify(data),
      err => {
        if (err) reject(err);
        resolve(data);
      }
    );
  });
};

/**
 * Download the whole repo & extract in docs.
 * Ideally it should extract only docs folder (not including `docs/history`), but I haven't figured that out yet.
 * Unzip's extract doesn't always emit 'close'. Maybe consider switching to a different zip library
 * @param {String} options.name A string that'll be used to name the folder.
 * @param {String} options.url github's url to a zipball.
 * @return {Promise}
 */
const writeHistoryFolder = options => {
  const { name, url } = options;
  return fetch(url)
    .then(
      res =>
        new Promise((resolve, reject) => {
          const downloadPath = path.resolve(__dirname, `zips/${name}.zip`);
          const dest = fs.createWriteStream(downloadPath);
          res.body.pipe(dest);
          res.body.on("error", err => reject(err));
          res.body.on("finish", () => resolve(downloadPath));
          dest.on("error", err => reject(err));

          console.log(`downloaded ${name}.zip`);
        })
    )
    .then(downloadPath => {
      console.log(`now unzipping...`);

      const unzipPath = path.join(historyFolderPath, name);
      const parse = unzip.Parse();

      fs.createReadStream(downloadPath)
        // .pipe(extract);
        .pipe(parse)
        .on("entry", entry => {
          const filePath = entry.path;
          const type = entry.type;
          const [root, subDir1, subDir2, ...rest] = filePath.split(path.sep);

          if (
            subDir1 === "docs" &&
            subDir2 !== "time-travel" &&
            type === "File"
          ) {
            const docsPath = path.join(
              unzipPath,
              subDir1,
              subDir2,
              rest.join("")
            );

            fs.ensureFile(docsPath)
              .then(() => {
                console.log(`path for ${docsPath} is created`);
                entry.pipe(fs.createWriteStream(docsPath));
              })
              .catch(err => {
                console.err(err);
              });
          } else {
            entry.autodrain();
          }
        });

      return new Promise((resolve, reject) => {
        parse.on("close", () => {
          console.log("unzip done.");
          resolve(unzipPath);
        });

        parse.on("error", err => reject(err));
      });
    })
    .catch(err => console.error(err));
};

getDataFromGithub()
  .then(writeJSONToDocs)
  .then(res => {
    const unzipPromises = res.data.repository.pullRequests.edges.map(edge => {
      const url = edge.node.mergeCommit.zipballUrl;
      const name = edge.node.id;

      return writeHistoryFolder({
        name,
        url
      });
    });

    return Promise.all(unzipPromises);
  })
  .then(paths => {
    console.log(
      `build complete. ${
        paths.length
      } folders has been written to ${historyFolderPath}.`
    );
  });
