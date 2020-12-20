const axios = require('axios').default;
const cheerio = require('cheerio');
const sqlite3 = require('sqlite3').verbose();

let tableCount;
let db;

function openDatabase(){
    db = new sqlite3.Database('./db/items.db', (err) => {
        if (err) {
            return console.error(err.message);
        }
    });
}

//creates the tables if they do not exist, then updates them as necessary
function init(){
    tableCount = 0;
    db.run('CREATE TABLE staticTable( title TEXT , productUrl TEXT , imageUrl TEXT , originalPrice TEXT );', function(err){
        if(err === null){
            console.log('Scraping for staticTable started.');
            scrapeItems('staticTable').then(scrapeResult =>{
                fillTable(scrapeResult, 'staticTable').then(()=>{
                    checkTables();
                });
            });
        }else{
            console.log('Static Table already exists!');
            checkTables();
        }
    });
    db.run('CREATE TABLE dynamicTable( title TEXT PRIMARY KEY, salePrice TEXT, stock TEXT, timestamp TEXT );', function(err){
        if(err !== null){
            db.run(`DELETE FROM dynamicTable;`);
        }
        console.log('Scraping for dynamicTable started.');
        scrapeItems('dynamicTable').then(scrapeResult => {
            fillTable(scrapeResult, 'dynamicTable').then(() =>{
                checkTables();
            });
        });
        
    });
        
}

//fills a given table given a collection of items and table name
async function fillTable(items, tableName){
    if(tableName === 'staticTable'){
        for (var i = 0; i < items.length; i++){
            db.run(`INSERT INTO staticTable (title, productUrl, imageUrl, originalPrice) VALUES ('`+items[i].title+`', '`+items[i].productUrl+`', '`+items[i].imageUrl+`', '`+items[i].originalPrice+`');`, function(err){
                if(err){
                    return console.error(err.message);
                }
            });
        }
    }else if(tableName === 'dynamicTable'){
        for (var i = 0; i < items.length; i++){
            db.run(`INSERT INTO dynamicTable (title, salePrice, stock, timestamp) VALUES ('`+items[i].title+`', '`+items[i].salePrice+`', '`+items[i].stock+`', '`+items[i].timestamp+`');`, function(err){
                if(err){
                    return console.error(err.message);
                }
            });
        }
    }
    console.log('Database filled.');
}


//obtains an html given a url
const fetchHtml =  async (url) => {
    var config = {
    headers: {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/57.0.2987.133 Safari/537.36'}
    };
    try{
        const { data } = await axios.get(url, config);
        return data;
    } catch {
        console.error(
            `ERROR: An error occured while trying to fetch the URL: ${url}`
        );
    }
};

//Fetches the html of an item and retrieves the stock information from its individual webpage
const extractItemWithStock = async (itemSelector, tableName) => {
    const html = await fetchHtml(getUrl(itemSelector));
    const selector = cheerio.load(html);
    let stock = selector("body")
        .find("#product > div[class='row clearfix'] > .span6")
        .find(".purchase > link[itemprop='availability']")
        .attr("href").trim();
    if(stock === 'http://schema.org/OutOfStock'){
        stock = 'Out of Stock';
    }else{
        stock = 'In Stock';
    }
    return extractItem(itemSelector, tableName, stock);
}

//obtains a collection of items from the /collections/all/ page
const scrapeItems = async (tableName) => {
    const bungieUrl = 'https://bungiestore.com/collections/all';
    const html = await fetchHtml(bungieUrl);
    const selector = cheerio.load(html);
    const searchResults = selector("body")
        .find("#collection > div[class='row products'] > div[class='product span4']");
    let i = 0;
    return Promise.all(searchResults.map((idx, el) => {
        const elementSelector = selector(el);
        if(tableName === 'staticTable'){
            return extractItem(elementSelector, 'staticTable', null)
        }else if(tableName === 'dynamicTable'){
            return extractItemWithStock(elementSelector, tableName);
        }
        console.error(`ERROR: Could not find table named '${tableName}'`);
    })
    .get()).then(result =>{
        console.log('Data extracted.');
        return result;
    });
};

//Extracts data from the /collections/all/ webpage
const extractItem = async (selector, tableName, stock) => {
    if(tableName === 'staticTable'){
        const title = selector
            .find(".details > a > h4[class='title']")
            .text()
            .trim();
        const productUrl = getUrl(selector);
        const imageUrl = 'https://www.bungiestore.com/'+selector
            .find(".image > a > img")
            .attr("src").trim();
        var originalPrice = selector
            .find(".details > a > span[class='price']")
            .text().trim();
        var lines = originalPrice.split('\n');
        lines.splice(1,lines.length);
        originalPrice = lines[0].replace(/ /g,'');
        console.log('Extracting to staticTable: '+title+'|'+productUrl+'|'+imageUrl+'|'+originalPrice);
        return { title, productUrl, imageUrl, originalPrice };
    }else if(tableName === 'dynamicTable'){
        const title = selector
            .find(".details > a > h4[class='title']")
            .text()
            .trim();
        var salePrice = selector
            .find(".details > a > span[class='price']")
            .text().trim().replace(/ /g,'');
        var lines = salePrice.split('\n');
        if(lines.length > 1){
            salePrice = lines[3].replace(/ /g,'')
        }
        const timestamp = new Date().toUTCString();
        console.log('Extracting to dynamicTable: '+title+'|'+salePrice+'|'+stock+'|'+timestamp);
        return { title, salePrice, stock, timestamp };
    }
}

//returns the url given a selector pointed at a product on the /collections/all/ page
const getUrl = (selector) => {
    return 'https://www.bungiestore.com/'+selector.find(".details > a").attr("href").trim();
}

//checks to see if all tables have finished updating
function checkTables(){
    tableCount++;
    if(tableCount === 2){
        db.close();
        console.log('Scrape finished.');
        console.log('Database closed.');
    }
}

//function to properly open the db and wipe the dynamicTable
function refresh(){
    console.log('Refreshing dynamicTable...');
    openDatabase();
    db.run(`DELETE FROM dynamicTable;`);
    init();
}


openDatabase();
init();
setInterval(refresh, 300*1000);