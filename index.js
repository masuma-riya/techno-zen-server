const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
const app = express();
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

// middlewares
app.use(cors());
app.use(express.json());

// mongodb
const uri = `mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@ac-wkac0pk-shard-00-00.rbwl5qc.mongodb.net:27017,ac-wkac0pk-shard-00-01.rbwl5qc.mongodb.net:27017,ac-wkac0pk-shard-00-02.rbwl5qc.mongodb.net:27017/?ssl=true&replicaSet=atlas-1019oo-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0`;

// Create a new MongoClient
const client = new MongoClient(uri, {});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const userCollection = client.db("technoZen").collection("users");
    const ProductCollection = client.db("technoZen").collection("products");
    const ReviewsCollection = client.db("technoZen").collection("reviews");
    const PaymentCollection = client.db("technoZen").collection("payments");

    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "5h",
      });
      res.send({ token });
    });

    // middlewares
    const verifyToken = (req, res, next) => {
      // console.log("inside verify token", req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization?.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized  access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // use verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded?.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // use verify moderator after verifyToken
    const verifyModerator = async (req, res, next) => {
      const email = req.decoded?.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isModerator = user?.role === "moderator";
      if (!isModerator) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // admin stats or analytics
    app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
      const products = await ProductCollection.estimatedDocumentCount();
      const reviews = await ReviewsCollection.estimatedDocumentCount();
      const users = await userCollection.estimatedDocumentCount();
      res.send({ products, reviews, users });
    });

    // all users data get
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    // ProductCollection data get only accepted
    app.get("/accPro", async (req, res) => {
      const result = await ProductCollection.find({
        ProductStatus: "Accepted",
      }).toArray();
      res.send(result);
    });

    // ProductCollection data get only Featured
    app.get("/featuredPro", async (req, res) => {
      const result = await ProductCollection.find({
        ProductType: "Featured",
      })
        .sort({ timestamp: -1 })
        .toArray();
      res.send(result);
    });

    // ProductCollection data get only reported
    app.get(
      "/reportedProduct",
      verifyToken,
      verifyModerator,
      async (req, res) => {
        const result = await ProductCollection.find({
          ProductFeedback: "Reported",
        }).toArray();
        res.send(result);
      }
    );

    // ProductCollection all data get
    app.get("/allProducts", async (req, res) => {
      const result = await ProductCollection.find().toArray();
      res.send(result);
    });

    // get single product data
    app.get("/allProducts/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await ProductCollection.findOne(query);
      res.send(result);
    });

    // all reviews data get
    app.get("/allReviews", verifyToken, async (req, res) => {
      const result = await ReviewsCollection.find().toArray();
      res.send(result);
    });

    // get myProducts
    app.get("/myProducts/:email", verifyToken, async (req, res) => {
      const result = await ProductCollection.find({
        email: req.params.email,
      }).toArray();
      res.send(result);
    });

    // sort by vote count des
    app.get("/trendingProducts", async (req, res) => {
      const { upVote } = req.query;
      const cursor = ProductCollection.find().sort({
        upVote: upVote || "desc",
      });
      const result = await cursor.toArray();
      res.send(result);
    });

    // admin
    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    // moderator
    app.get("/users/moderator/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let moderator = false;
      if (user) {
        moderator = user?.role === "moderator";
      }
      res.send({ moderator });
    });

    // isMember
    app.get("/users/member/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let member = false;
      if (user) {
        member = user?.isMember === true;
      }
      res.send({ member });
    });

    // payment intent
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      console.log(amount, "amount inside the intent");

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // payment save
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const { email } = req.body;
      const paymentResult = await PaymentCollection.insertOne(payment);
      if (paymentResult.insertedId) {
        const updatedDoc = {
          $set: {
            isMember: true,
          },
        };
        await userCollection.updateOne({ email }, updatedDoc);
      }
      res.send({ paymentResult });
    });

    // Reveiw collection data post
    app.post("/addReview", verifyToken, async (req, res) => {
      const usersReview = req.body;
      const result = await ReviewsCollection.insertOne(usersReview);
      res.send(result);
    });

    // Product collection data post
    app.post("/products", verifyToken, async (req, res) => {
      const productsItem = req.body;
      productsItem.timestamp = new Date().toISOString();
      const result = await ProductCollection.insertOne(productsItem);
      res.send(result);
    });

    // users data save to database when a user login
    app.post("/users", async (req, res) => {
      const user = req.body;
      // insert email if user doesnt exists:
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "User already exists", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // user role change to admin
    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    // user role change to moderator
    app.patch(
      "/users/moderator/:id",
      verifyToken,
      verifyModerator,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "moderator",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.put("/voteCount/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const userEmail = req.body.userEmail;
      const query = { _id: new ObjectId(id) };

      try {
        const findProduct = await ProductCollection.findOne(query);

        if (findProduct.voters && findProduct.voters.includes(userEmail)) {
          return;
        }

        const updatedDoc = {
          $inc: { upVote: 1 },
          $push: { voters: userEmail },
        };

        const result = await ProductCollection.updateOne(query, {
          $inc: { upVote: 1 },
          $push: { voters: userEmail },
        });

        res.status(200).json(result);
      } catch (error) {
        console.error("Error while updating vote count:", error);
      }
    });

    // change productType to featured
    app.put(
      "/productType/:id",
      verifyToken,
      verifyModerator,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const newType = "Featured";

        try {
          const result = await ProductCollection.updateOne(filter, {
            $set: { ProductType: newType },
          });

          if (result.modifiedCount > 0) {
            res
              .status(200)
              .json({ message: "Product Type Updated successfully" });
          } else {
            res
              .status(404)
              .json({ message: "Product not found or Type not updated" });
          }
        } catch (error) {
          console.error("Error updating product Type:", error);
          res.status(500).json({ message: "Internal server error" });
        }
      }
    );

    // change pending product status to Accepted
    app.put(
      "/acceptedProduct/:id",
      verifyToken,
      verifyModerator,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const newStatus = "Accepted";

        try {
          const result = await ProductCollection.updateOne(filter, {
            $set: { ProductStatus: newStatus },
          });

          if (result.modifiedCount > 0) {
            res
              .status(200)
              .json({ message: "Product status updated successfully" });
          } else {
            res
              .status(404)
              .json({ message: "Product not found or status not updated" });
          }
        } catch (error) {
          console.error("Error updating product status:", error);
          res.status(500).json({ message: "Internal server error" });
        }
      }
    );

    // change pending product status to Rejected
    app.put(
      "/rejectedProduct/:id",
      verifyToken,
      verifyModerator,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const newStatus = "Rejected";

        try {
          const result = await ProductCollection.updateOne(filter, {
            $set: { ProductStatus: newStatus },
          });

          if (result.modifiedCount > 0) {
            res
              .status(200)
              .json({ message: "Product status updated successfully" });
          } else {
            res
              .status(404)
              .json({ message: "Product not found or status not updated" });
          }
        } catch (error) {
          console.error("Error updating product status:", error);
          res.status(500).json({ message: "Internal server error" });
        }
      }
    );

    // change ProductFeedback to Reported
    app.put("/reportdProduct/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const newFeedback = "Reported";

      try {
        const result = await ProductCollection.updateOne(filter, {
          $set: { ProductFeedback: newFeedback },
        });

        if (result.modifiedCount > 0) {
          res
            .status(200)
            .json({ message: "Product Feedback updated successfully" });
        } else {
          res
            .status(404)
            .json({ message: "Product not found or Feedback not updated" });
        }
      } catch (error) {
        console.error("Error updating product Feedback:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // update a product
    app.put("/allProducts/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updateProduct = req.body;
      const product = {
        $set: {
          productName: updateProduct.productName,
          productImage: updateProduct.productImage,
          description: updateProduct.description,
          link: updateProduct.link,
        },
      };
      const result = await ProductCollection.updateOne(
        filter,
        product,
        options
      );
      res.send(result);
    });

    // delete reported products
    app.delete(
      "/products/:id",
      verifyToken,
      verifyModerator,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await ProductCollection.deleteOne(query);
        res.send(result);
      }
    );

    // delete my added food
    app.delete("/allProducts/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await ProductCollection.deleteOne(query);
      res.send(result);
    });

    // aggregate pipeline
    app.get("/product-stats", verifyToken, verifyAdmin, async (req, res) => {
      const result = await ProductCollection.aggregate([]).toArray();

      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Techno Zen server side is running on...");
});

app.listen(port, () => {
  console.log(`Techno Zen running on http://localhost:${5000}`);
});
