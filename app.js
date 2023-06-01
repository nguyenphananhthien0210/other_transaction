
const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider('https://rpc.ankr.com/polygon_mumbai'));
const axios = require('axios');

const moment = require('moment');

const express = require('express');
const app = express();
const port = 4000;

const ApolloClient = require('apollo-client').ApolloClient;
const gql = require('apollo-boost').gql;
const { HttpLink } = require('apollo-link-http');
const { InMemoryCache } = require('apollo-cache-inmemory');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.CONNECTED_MONGODB_URI
const client = new MongoClient(uri);

const httpLink = new HttpLink({
    uri: 'https://api.studio.thegraph.com/query/46682/subgraph_demark/2',
});

const cache = new InMemoryCache();

const apolloClient = new ApolloClient({
    link: httpLink,
    cache: cache,
});

const query = gql`
  query {
    makeTransactions {
      id
      action
      amounterc
      amountnft
      blockTime
      blockNumber
      dml
      price
      sender
      to
      transactionHash
    }
  }
`;


async function querySubgraph() {
    try {
        await client.connect();
        console.log('Connected to MongoDB successfully');

        const response = await apolloClient.query({ query });
        const results = response.data.makeTransactions;

        const newRecords = [];

        for (const record of results) {
            const { dml } = record;
            const { tokenName, nftName } = await getNftAndTokenName(dml);
            console.log('Token Name:', tokenName);
            console.log('NFT Name:', nftName);

            const existingAction = record.action
            const updatedAction = `${existingAction} ${nftName} from ${tokenName}`;
            record.action = updatedAction;

            console.log('Updated Action:', updatedAction);

            // Check if record already exists
            const collection = client.db('Mydata4').collection('new_collection4');
            const existingRecord = await collection.findOne({ id: record.id });

            if (existingRecord) {
                console.log(`Record with id ${record.id} already exists. Skipping insertion.`);
            } else {
                newRecords.push(record);
            }

        }

        // Insert new records into the database
        if (newRecords.length > 0) {
            const collection = client.db('Mydata4').collection('new_collection4');
            const insertResult = await collection.insertMany(newRecords);
            console.log(`${insertResult.insertedCount} new records inserted`);
        } else {
            console.log('No new records to insert.');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        client.close();
        console.log('MongoDB connection closed');
    }
}

async function getNftAndTokenName(dmlAddress) {
    try {
        const apiUrl = `https://api-testnet.polygonscan.com/api?module=contract&action=getabi&address=${dmlAddress}`;
        const response = await axios.get(apiUrl);

        const abi = JSON.parse(response.data.result);
        const contract = new web3.eth.Contract(abi, dmlAddress);

        const contractToken = new web3.eth.Contract(abi, await contract.methods.tokenerc().call());
        const contractNFT = new web3.eth.Contract(abi, await contract.methods.tokennft().call());

        const tokenName = contractToken.methods.name ? await contractToken.methods.name().call() : '';
        const nftName = contractNFT.methods.name ? await contractNFT.methods.name().call() : '';

        return { tokenName, nftName };

    } catch (error) {
        console.error(error);
        return { tokenName: '', nftName: '' };
    }
}

querySubgraph()

app.get('/data', async (req, res) => {
    try {
        await client.connect();
        const collection = client.db('Mydata4').collection('new_collection4');

        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        // Fetch data and sort by blockTime in descending order
        const data = await collection
            .find()
            .sort({ blockTime: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        // Extract the required fields and format the response
        const formattedData = data.map((record) => {
            const { action, amountnft, amounterc, sender, blockTime, transactionHash } = record;

            // Convert blockTime to relative time
            const blockTimeRelative = moment.unix(blockTime).fromNow();

            // Generate the link for the action value
            const actionLink = `https://mumbai.polygonscan.com/tx/${transactionHash}`;

            return {
                action: {
                    value: action,
                    link: actionLink,
                },
                amountnft,
                amounterc,
                sender,
                blockTime: blockTimeRelative,
            };
        });

        // Calculate total pages
        const count = await collection.countDocuments();
        const totalPages = Math.ceil(count / limit);

        // Check if there is a next page
        const hasNextPage = skip + limit < count;

        // Check if there is a previous page
        const hasPreviousPage = page > 1;

        // Generate links for next and previous pages
        const baseUrl = `${req.protocol}://${req.get('host')}${req.originalUrl.split('?')[0]}`;
        const nextUrl = hasNextPage ? `${baseUrl}?page=${page + 1}` : null;
        const prevUrl = hasPreviousPage ? `${baseUrl}?page=${page - 1}` : null;

        res.json({
            data: formattedData,
            totalPages,
            currentPage: page,
            hasNextPage,
            hasPreviousPage,
            totalRecords: count,
            nextPage: nextUrl,
            previousPage: prevUrl,
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'An error occurred' });
    } finally {
        client.close();
    }
});

app.listen(port, () => {
    console.log(`API server is running on port ${port}`);
});