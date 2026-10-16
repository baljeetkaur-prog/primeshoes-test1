const express = require("express");
const serverless = require("serverless-http");
const cors = require("cors");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken"); 
// const path = require('path');
const multer = require('multer');
// const fs = require('fs');
const Razorpay = require("razorpay");
const crypto = require("crypto");
const { v2: cloudinary } = require("cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const slugify = require('slugify');
const axios = require("axios");
const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);


require("dotenv").config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});


const app = express();
// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const PORT = process.env.PORT || 9000;
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const createRazorpayRefund = async ({
  paymentId,
  amountPaise,
  idempotencyKey,
  receipt,
}) => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials are missing");
  }

  const response = await fetch(
    `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${keyId}:${keySecret}`).toString("base64"),
        "Content-Type": "application/json",
        "X-Refund-Idempotency": idempotencyKey,
      },
      body: JSON.stringify({
        amount: amountPaise,
        speed: "optimum",
        receipt,
      }),
      signal: AbortSignal.timeout(20000),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data?.error?.description || `Razorpay refund request failed (${response.status})`
    );
    error.status = response.status;
    error.razorpayError = data?.error;
    throw error;
  }

  return data;
};
const verifyAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
if (!['admin', 'superadmin'].includes(decoded.role)) {
  return res.status(403).json({ error: 'Forbidden' });
}
    req.admin = decoded;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Token invalid or expired' });
  }
};

async function restoreReturnedItemStock(orderId, variantId) {
  let stockWasRestored = false;
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      // Lock this specific item against duplicate restoration.
      const order = await Order.findOneAndUpdate(
        {
          _id: orderId,
          items: {
        $elemMatch: {
  variantId,
  stockRestored: false,
  refundStatus: "Refunded",
  status: "Returned",
  isReturned: true,
  returnInspected: true,
},
          },
        },
        {
          $set: {
            "items.$.stockRestored": true,
          },
        },
        {
          new: true,
          session,
        }
      );

  if (!order) {
  // Already restored, or not eligible for restoration.
  return;
}

stockWasRestored = true;

      const item = order.items.find(
        (entry) =>
          entry.variantId?.toString() === variantId.toString()
      );

      if (!item?.productId || !item?.variantId || item.quantity <= 0) {
        throw new Error("Cannot restore stock: item details are invalid");
      }

      const result = await Product.updateOne(
        {
          _id: item.productId,
          "variants._id": item.variantId,
        },
        {
          $inc: {
            "variants.$.quantity": item.quantity,
          },
        },
        { session }
      );

      if (result.matchedCount !== 1) {
        throw new Error("Product variant not found; stock was not restored");
      }
    });

  return {
  success: stockWasRestored,
  restored: stockWasRestored,
};
  } finally {
    await session.endSession();
  }
}


app.post(
  "/api/admin/returns/:orderId/inspect",
  verifyAdmin,
  async (req, res) => {
    try {
      const { variantId, approvedForResale } = req.body || {};

      if (!variantId || approvedForResale !== true) {
        return res.status(400).json({
          message:
            "Confirm that the returned shoes were inspected and are suitable for resale",
        });
      }

      const order = await Order.findById(req.params.orderId);

      if (!order) {
        return res.status(404).json({
          message: "Order not found",
        });
      }

      const item = order.items.find(
        (entry) =>
          entry.variantId?.toString() === variantId.toString()
      );

      if (!item) {
        return res.status(404).json({
          message: "Order item not found",
        });
      }

      // Only inspect an item with an outstanding return request.
      if (
        item.status !== "Return Requested" ||
        item.refundStatus !== "Pending" ||
        item.isReturned
      ) {
        return res.status(400).json({
          message:
            "Only an item with a pending return request can be inspected",
        });
      }

      if (item.stockRestored) {
        return res.status(409).json({
          message: "Stock has already been restored for this item",
        });
      }

      // Record inspection only. Do not refund or restore stock here.
      item.returnInspected = true;

      await order.save();

      return res.json({
        success: true,
        message:
          "Inspection recorded. The item is now ready for refund approval.",
      });
    } catch (error) {
      console.error("Return Inspection Error:", error);

      return res.status(500).json({
        message: "Could not record the return inspection",
      });
    }
  }
);






app.use('/img', express.static('public/img', {
  maxAge: '30d', // cache for 30 days
  etag: false
}));
async function revalidateCartCoupon(cart) {

  if (!cart?.coupon?.code) return;

  const coupon = await Coupon.findOne({
    code: cart.coupon.code,
    active: true
  });

  if (!coupon) {
    cart.coupon = null;
    return;
  }

  let subtotal = 0;

  for (const item of cart.items) {

    const product = await Product.findById(item.productId);

    if (!product) continue;

    const price =
      product.discountedPrice ||
      product.originalPrice ||
      0;

    subtotal += price * item.quantity;
  }

  const now = new Date();

  const invalidCoupon =
    (coupon.startDate && now < coupon.startDate) ||
    (coupon.expiryDate && now > coupon.expiryDate) ||
    (coupon.usedCount >= coupon.totalUsageLimit) ||
    (subtotal < coupon.minOrderAmount);

  if (invalidCoupon) {
    cart.coupon = null;
  }
}
function getProductWeight(category) {
  switch (category) {
    case "men":
      return 1.0;

    case "women":
      return 0.7;

    case "kids":
      return 0.5;

    case "handbags":
      return 0.8;

    case "accessories":
      return 0.2;

    default:
      return 0.8;
  }
}
async function getShiprocketToken() {
  const response = await axios.post(
    "https://apiv2.shiprocket.in/v1/external/auth/login",
    {
      email: process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD,
    }
  );

  return response.data.token;
}
async function createShiprocketOrder(order) {
  const token = await getShiprocketToken();
  let totalWeight = 0;

for (const item of order.items) {
  const product = await Product.findById(item.productId);

  if (!product) continue;

  totalWeight +=
    getProductWeight(product.category) *
    item.quantity;
}
console.log("Calculated Shiprocket Weight:", totalWeight);

  const response = await axios.post(
    "https://apiv2.shiprocket.in/v1/external/orders/create/adhoc",
    {
      order_id: order.orderNumber,
      order_date: new Date().toISOString().split("T")[0],

      pickup_location: "work",

      billing_customer_name: order.billing.firstName,
      billing_last_name: order.billing.lastName,

      billing_address:
        order.billing.addressLine1 +
        " " +
        (order.billing.addressLine2 || ""),

      billing_city: order.billing.city,
      billing_pincode: order.billing.zip,
      billing_state: order.billing.state,
      billing_country: order.billing.country,
      billing_email: order.billing.email,
      billing_phone: order.billing.phone,

      shipping_is_billing: true,

      order_items: order.items.map((item) => ({
        name: item.title,
        sku: item.productId.toString(),
        units: item.quantity,
        selling_price: item.discountPrice,
      })),

      payment_method:
        order.paymentMode === "cod" ? "COD" : "Prepaid",

      sub_total: order.finalTotal,

   length: 30,
breadth: 20,
height: 10,
weight: Number(totalWeight.toFixed(2)),
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return response.data;
}

async function shipOrderToShiprocket(orderId) {
  const order = await Order.findById(orderId);
  if (!order) return;
  
  // Never ship cancelled orders
  if (
    order.status === "Cancelled" ||
    order.shippingStatus === "Cancelled"
  ) {
    console.log("Shiprocket skipped: order is cancelled.");
    return;
  }

  // Online orders must be paid before shipping
  if (
    order.paymentMode !== "cod" &&
    !order.isPaid
  ) {
    throw new Error(
      "Shiprocket skipped: online payment is not confirmed."
    );
  }


  // TEST MODE: never contact Shiprocket
  if (process.env.SHIPROCKET_TEST_MODE === "true") {
    console.log("TEST MODE: Shiprocket skipped");

    order.shiprocketOrderId = "TEST_" + order._id;
    order.shiprocketShipmentId = "TEST_" + order._id;
    order.shippingStatus = "Processing";
    order.isTestOrder = true;

    await order.save();
    return;
  }

  try {
    // 1. Create or reuse the Shiprocket shipment
    let shipment_id = order.shiprocketShipmentId;

    if (!order.shiprocketOrderId || !shipment_id) {
      const createRes = await createShiprocketOrder(order);

      shipment_id = createRes.shipment_id;

      if (!createRes.order_id || !shipment_id) {
        throw new Error("Shiprocket order or shipment ID is missing.");
      }

      order.shiprocketOrderId = createRes.order_id;
      order.shiprocketShipmentId = shipment_id;
      order.shippingStatus = "Processing";
      await order.save();
    }

    // 2. Assign AWB if not already assigned
    if (!order.awbCode) {
      const awbRes = await assignAWB(shipment_id);

      console.log("AWB RESPONSE:", awbRes);

      if (awbRes.awb_assign_status !== 1) {
        throw new Error("Shiprocket could not assign an AWB.");
      }

      order.awbCode = awbRes.response.data.awb_code;
      order.courierName = awbRes.response.data.courier_name;
      await order.save();
    }

    // 3. Schedule pickup after AWB assignment
    if (order.awbCode && !order.pickupScheduled) {
      const pickupRes = await scheduleShiprocketPickup(
        order.shiprocketShipmentId
      );

      console.log("SHIPROCKET PICKUP RESPONSE:", pickupRes);

      if (pickupRes.pickup_status !== 1) {
        throw new Error("Shiprocket did not confirm pickup scheduling.");
      }

      order.pickupScheduled = true;
      order.pickupScheduledAt =
        pickupRes.response?.pickup_scheduled_date
          ? new Date(pickupRes.response.pickup_scheduled_date)
          : new Date();

      order.pickupTokenNumber =
        pickupRes.response?.pickup_token_number || null;

      await order.save();
    }

    // 4. Generate manifest only after pickup is scheduled
    if (order.pickupScheduled && !order.manifestGenerated) {
      const manifestRes = await generateShiprocketManifest(
        order.shiprocketShipmentId
      );

      console.log("SHIPROCKET MANIFEST RESPONSE:", manifestRes);

      if (
        manifestRes.status !== 1 ||
        !manifestRes.manifest_url
      ) {
        throw new Error("Shiprocket did not return a manifest URL.");
      }

      order.manifestUrl = manifestRes.manifest_url;
      order.manifestGenerated = true;
      await order.save();
    }


    // 5. Generate shipping label if not already generated
    if (order.awbCode && !order.labelGenerated) {
      const labelRes = await generateShiprocketLabel(
        order.shiprocketShipmentId
      );

      console.log("SHIPROCKET LABEL RESPONSE:", labelRes);

      if (
        labelRes.label_created !== 1 ||
        !labelRes.label_url
      ) {
        throw new Error(
          "Shiprocket did not return a shipping label URL."
        );
      }

      order.labelUrl = labelRes.label_url;
      order.labelGenerated = true;

      await order.save();
    }

    // 6. Retrieve tracking information

    if (order.awbCode) {
      const track = await trackShipment(order.awbCode);

      order.trackingUrl =
        track?.tracking_data?.track_url || null;

      await order.save();
    }

    order.shippingStatus = "Processing";
    await order.save();
  } catch (err) {
 console.error("Shiprocket operation failed:", {
  orderId: order._id.toString(),
  shiprocketOrderId: order.shiprocketOrderId,
  shipmentId: order.shiprocketShipmentId,
  awbCode: order.awbCode,
  pickupScheduled: order.pickupScheduled,
  manifestGenerated: order.manifestGenerated,
  labelGenerated: order.labelGenerated,
  error: err.response?.data || err.message,
});

    order.shippingStatus = "Failed";
    await order.save();

    throw err;
  }
}

async function assignAWB(shipment_id) {
  const token = await getShiprocketToken();

  const response = await axios.post(
    "https://apiv2.shiprocket.in/v1/external/courier/assign/awb",
    {
      shipment_id,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return response.data;
}

async function scheduleShiprocketPickup(shipment_id) {
  if (!shipment_id) {
    throw new Error("Shiprocket shipment ID is required.");
  }

  const token = await getShiprocketToken();

  const response = await axios.post(
    "https://apiv2.shiprocket.in/v1/external/courier/generate/pickup",
    {
      shipment_id: [shipment_id],
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return response.data;
}

async function generateShiprocketManifest(shipment_id) {
  if (!shipment_id) {
    throw new Error("Shiprocket shipment ID is required.");
  }

  const token = await getShiprocketToken();

  const response = await axios.post(
    "https://apiv2.shiprocket.in/v1/external/manifests/generate",
    {
      shipment_id: [shipment_id],
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (
    response.data?.status !== 1 ||
    !response.data?.manifest_url
  ) {
    throw new Error(
      "Shiprocket did not return a manifest URL."
    );
  }

  return response.data;
}

async function generateShiprocketLabel(shipment_id) {
  if (!shipment_id) {
    throw new Error("Shiprocket shipment ID is required.");
  }

  const token = await getShiprocketToken();

  const response = await axios.post(
    "https://apiv2.shiprocket.in/v1/external/courier/generate/label",
    {
      shipment_id: [shipment_id],
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (
    response.data?.label_created !== 1 ||
    !response.data?.label_url
  ) {
    throw new Error(
      "Shiprocket did not return a shipping label URL."
    );
  }

  return response.data;
}



async function trackShipment(awb) {
  const token = await getShiprocketToken();

  const response = await axios.get(
    `https://apiv2.shiprocket.in/v1/external/courier/track/awb/${awb}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return response.data;
}



// const baseUploadPath = path.join(__dirname, 'public/uploads');
// if (!fs.existsSync(baseUploadPath)) {
//   fs.mkdirSync(baseUploadPath, { recursive: true });
// }
// const reviewsDir = path.join(baseUploadPath, 'reviews');
// if (!fs.existsSync(reviewsDir)) {
//   fs.mkdirSync(reviewsDir, { recursive: true });
// }

// Multer storage logic for reviews
// const storage = multer.diskStorage({
//   destination: function (req, file, cb) {
//     cb(null, reviewsDir);
//   },
//   filename: function (req, file, cb) {
//     const ext = path.extname(file.originalname);
//     const uniqueName = Date.now() + '-' + file.fieldname + ext;
//     cb(null, uniqueName);
//   }
// });
const isSuperAdmin = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: 'Unauthorized: No token' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== 'superadmin') {
      return res.status(403).json({ message: 'Forbidden: Not a superadmin' });
    }

    req.admin = decoded;
    next();
  } catch (err) {
    console.error('[isSuperAdmin Error]:', err);
    res.status(401).json({ message: 'Invalid Token' });
  }
};



// const upload = multer({ storage });
// const productStorage = multer.diskStorage({
//   destination: function (req, file, cb) {
//     cb(null, baseUploadPath); // <-- uploads to /public/uploads
//   },
//   filename: function (req, file, cb) {
//     const ext = path.extname(file.originalname);
//     const uniqueName = Date.now() + '-' + file.fieldname + ext;
//     cb(null, uniqueName);
//   }
// });

// const productUpload = multer({ storage: productStorage });

// Serve static files (so browser can access image URLs)
// app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
const reviewStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "prime-shoes/reviews",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
  },
});
const upload = multer({ storage: reviewStorage });

// Product image upload storage
const productStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "prime-shoes/products",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
  },
});
const productUpload = multer({ storage: productStorage });
const checkReviewExists = async (req, res, next) => {
  const { email } = req.body;
  const { productId } = req.params;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const alreadyReviewed = product.reviews.find(
      r => r.user.toString() === user._id.toString()
    );

    if (alreadyReviewed) {
      return res.status(400).json({ error: 'You have already reviewed this product.' });
    }

    // Attach product and user to req to avoid refetching
    req.userDoc = user;
    req.productDoc = product;
    next();
  } catch (err) {
    console.error('Error in review check middleware:', err);
    res.status(500).json({ error: 'Internal error while checking review status.' });
  }
};

async function addSlugsToOldProducts() {
  try {
    const productsWithoutSlug = await Product.find({ $or: [{ slug: { $exists: false } }, { slug: '' }] });

    console.log(`Found ${productsWithoutSlug.length} products without slug.`);

    for (let product of productsWithoutSlug) {
      // Generate slug from title
      let baseSlug = slugify(product.title, { lower: true, strict: true });

      // Ensure uniqueness
      let slug = baseSlug;
      let counter = 1;
      while (await Product.exists({ slug })) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }

      product.slug = slug;
      await product.save();
      console.log(`Updated product "${product.title}" with slug: ${slug}`);
    }

    console.log('All missing slugs have been added.');
  } catch (err) {
    console.error('Error adding slugs:', err);
  }
}





// Connect to MongoDB
(async () => {
  try {
   await mongoose.connect(
  'mongodb+srv://baljeetkor6:baljeet123@cluster0.ga6t9b7.mongodb.net/primeshoes?retryWrites=true&w=majority&appName=Cluster0'
);
    console.log('MongoDB Connected');

    // Add slugs to old products
    await addSlugsToOldProducts();

    // Start your server after DB connection
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (e) {
  console.error("MongoDB Error:");
  console.error(e);
}
})();
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: { type: String, required: true },
  password: { type: String, required: true },
  usedCoupons: [
{
  couponCode: String,
  count: Number
}
], 

  // ✅ NEW: Saved Addresses
  addresses: [
    {
      _id: { type: mongoose.Schema.Types.ObjectId, auto: true }, // Auto-generated ID
      firstName: { type: String, required: true },
      lastName: { type: String, required: true },
      country: { type: String, default: "IN" },
      addressLine1: { type: String, required: true },
      addressLine2: { type: String },
      city: { type: String, required: true },
      state: { type: String, required: true },
      zip: { type: String, required: true },
      phone: { type: String, required: true },
      isDefault: { type: Boolean, default: false }
    }
  ]
}, { timestamps: true });
userSchema.methods.comparePassword = async function (inputPassword) {
  return await bcrypt.compare(inputPassword, this.password);
};
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

const User = mongoose.model("User", userSchema, "User");
app.get('/api/migrate-addresses', async (req, res) => {
  try {
    const result = await User.updateMany(
      { addresses: { $exists: false } }, 
      { $set: { addresses: [] } }
    );

    console.log("Migration completed:", result);
    res.json({ 
      message: "Migration completed successfully!", 
      modifiedCount: result.modifiedCount 
    });
  } catch (error) {
    console.error("Migration error:", error);
    res.status(500).json({ message: "Migration failed", error: error.message });
  }
});
app.post("/api/auth/register", async (req, res) => {
  try {

    const { captcha } = req.body;

    // 1. CAPTCHA CHECK FIRST
    if (!captcha) {
      return res.status(400).json({ message: "Captcha is required." });
    }

    const verifyURL = `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${captcha}`;

    const captchaRes = await axios.post(verifyURL);

    if (!captchaRes.data.success) {
      return res.status(400).json({ message: "Captcha verification failed." });
    }

    // 2. your existing logic
    const decoded = JSON.parse(
      Buffer.from(req.body.payload, "base64").toString("utf8")
    );

    const { name, email, phone, password } = decoded;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      name,
      email,
      phone,
      password: hashedPassword,
    });

    await newUser.save();

    res.status(201).json({ message: "User registered successfully." });

  } catch (error) {
    console.error("Registration Error:", error);
    res.status(500).json({ message: "Server error. Please try again." });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {

    // ✅ 1. CAPTCHA VALIDATION FIRST
    const { captcha } = req.body;

    if (!captcha) {
      return res.status(400).json({ message: "Captcha is required." });
    }

    const verifyURL = `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${captcha}`;

    const captchaRes = await axios.post(verifyURL);

    if (!captchaRes.data.success) {
      return res.status(400).json({ message: "Captcha verification failed." });
    }

    // ✅ 2. YOUR EXISTING LOGIN LOGIC
    const decoded = JSON.parse(
      Buffer.from(req.body.payload, "base64").toString("utf8")
    );

    const { email, password } = decoded;

    // Check user
    const user = await User.findOne({ email });
    if (!user)
      return res.status(400).json({ message: "Invalid email or password." });

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Invalid email or password." });

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const encodedToken = Buffer.from(token).toString("base64");

    res.status(200).json({
      message: "Login successful.",
      token: encodedToken,
      user: {
        name: user.name,
        email: user.email,
        phone: user.phone,
      },
    });

  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: "Server error. Please try again." });
  }
});
app.post('/api/auth/changepassword', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Basic validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "All fields are required." });
    }

    // Find the user by email from the decoded token
    const user = await User.findOne({ email: req.user.email });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // Compare current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect." });
    }

    // Hash and update the new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    return res.status(200).json({ message: "Password updated successfully." });
  } catch (err) {
    console.error("Change Password Error:", err);
    return res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});
app.get("/api/auth/me", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password");

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    res.status(200).json({
      user
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Server error"
    });
  }
});
const variantSchema = new mongoose.Schema({
  color: {
    type: String,
    required: true,
    trim: true,
  },

  size: {
    type: String,
    required: true,
    trim: true,
  },

  quantity: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },

  sku: {
    type: String,
    default: "",
  }
}, { _id: true });


const productSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  brand: {
    type: String,
    trim: true,
    default: "Prime Shoes",
  },
  category: {
    type: String,
    enum: ['men', 'women', 'kids', 'handbags', 'accessories'],
    required: true,
  },
  mainImage: {
    url: { type: String, required: true },
    publicId: { type: String, required: true }
  },
  otherImages: [
    {
      url: { type: String, required: true },
      publicId: { type: String, required: true }
    }
  ],
  description: {
    type: String,
    required: true,
  },
  originalPrice: {
    type: Number,
    required: true,
  },
  discountedPrice: {
    type: Number,
    required: true,
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5,
  },
  numReviews: {
    type: Number,
    default: 0,
  },
  reviews: [
    {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      name: {
        type: String,
        required: true
      },
      rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
        default: 5
      },
      comment: {
        type: String,
        required: true
      },
image: {
  publicId: { type: String, required: false },
  url: { type: String, required: false }
},
      createdAt: {
        type: Date,
        default: Date.now
      }
    }
  ],
  variants: [variantSchema],
  label: {
    type: String,
    enum: ['New', 'Sale', 'Out Of Stock', ''],
    default: '',
  },
  specifications: {
    type: String,
    trim: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
    views: {
    type: Number,
    default: 0
  }, 
  slug: { type: String, unique: true, trim: true }, 
});



function arrayLimit(val) {
  return val.length <= 4;
}

productSchema.pre('validate', function(next) {
  if (this.title) {
    this.slug = slugify(this.title, { lower: true, strict: true });
  }
  next();
});




const Product = mongoose.model('Product', productSchema, "Product");

app.post(
  "/api/products",
  productUpload.fields([
    { name: "mainImage", maxCount: 1 },
    { name: "otherImages", maxCount: 4 },
  ]),
  async (req, res) => {
    const session = await Product.startSession(); // optional if you want transactions
    session.startTransaction();

    try {
const {
  title,
  brand,
  category,
  description,
  originalPrice,
  discountedPrice,
  rating,
  numReviews,
  variants,
  label,
  specifications
} = req.body;

      const mainImage = req.files["mainImage"]?.[0];
      const otherImages = req.files["otherImages"] || [];

      if (!mainImage) {
        return res.status(400).json({ message: "Main image is required" });
      }

      const product = new Product({
        title,
        brand,
        category,
        description,
        specifications,
        originalPrice,
        discountedPrice,
        rating: rating || 0,
        numReviews: numReviews || 0,
      variants: JSON.parse(variants || "[]"),
        label,
        mainImage: {
          url: mainImage.path,
          publicId: mainImage.filename,
        },
        otherImages: otherImages.map((file) => ({
          url: file.path,
          publicId: file.filename,
        })),
      });

      await product.save({ session });
      await session.commitTransaction();

      res.status(201).json({ message: "Product created", product });

    } catch (err) {
      console.error("Product Upload Error:", err);

      // ❌ Delete images from Cloudinary if DB save fails
      if (req.files["mainImage"]) {
        await cloudinary.uploader.destroy(req.files["mainImage"][0].filename);
      }
      if (req.files["otherImages"]) {
        for (let file of req.files["otherImages"]) {
          await cloudinary.uploader.destroy(file.filename);
        }
      }

      await session.abortTransaction();
      res.status(500).json({ message: "Server error, images removed from Cloudinary" });
    } finally {
      session.endSession();
    }
  }
);

app.get('/api/products', async (req, res) => {
  try {
    const { category, sizes, colors, minPrice, maxPrice, label, page = 1, limit = 9 } = req.query;

    const filter = {};

    if (category) {
      filter.category = { $regex: new RegExp(`^${category.trim()}$`, 'i') };
    }

 if (sizes) {
  const sizesArray = sizes.split(',').map(size => size.trim());

  filter["variants.size"] = {
    $in: sizesArray
  };
}

if (colors) {
  const colorsArray = colors
    .split(',')
    .map(color => color.trim());

  filter["variants.color"] = {
    $in: colorsArray.map(
      c => new RegExp(`^${c}$`, 'i')
    )
  };
}

    if (minPrice || maxPrice) {
      filter.discountedPrice = {};
      if (minPrice) filter.discountedPrice.$gte = parseInt(minPrice);
      if (maxPrice) filter.discountedPrice.$lte = parseInt(maxPrice);
    }

    // **Add this block for label filter**
    if (label) {
      filter.label = { $regex: new RegExp(`^${label.trim()}$`, 'i') };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.status(200).json({
      products,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
    });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/latest', async (req, res) => {
  try {
    const filter = {};
    if (req.query.category && req.query.category !== '*') {
      filter.category = req.query.category.toLowerCase();
    }

    const latestProducts = await Product.find(filter)
      .sort({ createdAt: -1 })
      .limit(250);

    res.json(latestProducts);
  } catch (err) {
    console.error('Error fetching latest products:', err);
    res.status(500).json({ message: 'Server error' });
  }
});





app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } }, // increment view count
      { new: true }
    );
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});
// Fetch product by slug
app.get('/api/products/slug/:slug', async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    
    // Increment views
    product.views = (product.views || 0) + 1;
    await product.save();

    res.json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/trendproducts', async (req, res) => {
  try {
    const allProducts = await Product.find();

    // 1. New Arrivals: latest by createdAt
    const newArrivals = allProducts
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      // no slice → all products

const trendingNow = allProducts
  .filter(product =>
    product.variants?.some(
      variant => variant.quantity > 0
    )
  )
  .sort((a, b) => {

    const totalA = a.variants.reduce(
      (sum, variant) => sum + variant.quantity,
      0
    );

    const totalB = b.variants.reduce(
      (sum, variant) => sum + variant.quantity,
      0
    );

    return totalB - totalA;
  });

    // 3. Just Launched: products explicitly marked as "new"
    const justLaunched = allProducts
      .filter(p => p.label?.toLowerCase() === "new");
      // no slice → all products

    // Send response
    res.json({
      newArrivals,
      trendingNow,
      justLaunched,
    });

  } catch (err) {
    console.error('Error fetching trends:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
app.get('/api/trending', async (req, res) => {
  try {
    const trending = await Product.find()
      .sort({ views: -1 }) // highest views first
      .limit(10);          // top 10 trending

    res.json(trending);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/products/category/:category', async (req, res) => {
  const categoryParam = req.params.category.toLowerCase();

  try {
    // Find products matching the category (case insensitive)
    const products = await Product.find({
      category: { $regex: new RegExp(`^${categoryParam}$`, 'i') }
    })
    .sort({ createdAt: -1 });  // latest first, optional

    if (!products.length) {
      return res.status(404).json({ message: 'No products found for this category.' });
    }

    res.status(200).json(products);
  } catch (error) {
    console.error('Error fetching products by category:', error);
    res.status(500).json({ message: 'Server error' });
  }
});
app.get('/api/products/categories/all', async (req, res) => {
  try {
    const categoryKeys = ['women', 'men', 'kids', 'handbags', 'accessories'];
    const categoryData = {};

    for (let cat of categoryKeys) {
      const products = await Product.find({ category: cat }).sort({ createdAt: -1 });
      categoryData[cat] = products || [];
    }

    res.status(200).json(categoryData);
  } catch (error) {
    console.error('Error fetching products by categories:', error);
    res.status(500).json({ message: 'Server error' });
  }
});



const cartSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
  },
items: [
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },

    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },

    quantity: {
      type: Number,
      required: true,
      min: 1
    },
  }
], 
coupon: {
  code: { type: String },
  discountType: { type: String },     
  discountValue: { type: Number },
  maxDiscount: { type: Number },
  appliedAt: { type: Date, default: Date.now }
}
});
app.get('/api/filters', async (req, res) => {
  try {
    const { category } = req.query;

    let query = {};

    if (category) {
      query.category = category;
    }

    const products = await Product.find(query, 'variants');

    const sizesSet = new Set();
    const colorsSet = new Set();

    products.forEach(product => {
      (product.variants || []).forEach(variant => {
        if (variant.size) sizesSet.add(variant.size);
        if (variant.color) colorsSet.add(variant.color);
      });
    });

    res.json({
      sizes: [...sizesSet],
      colors: [...colorsSet],
    });
  } catch (err) {
    console.error("Error fetching filters:", err);
    res.status(500).json({ error: "Server error" });
  }
});



const Cart=mongoose.model("Cart", cartSchema, "Cart")

app.post('/api/addtocart', async (req, res) => {

  try {

    const {
      email,
      productId,
      variantId,
      quantity
    } = req.body;

    if (!email || !productId || !variantId || !quantity) {

      return res.status(400).json({
        success: false,
        message: 'Missing required fields.'
      });

    }

    const product = await Product.findById(productId);

    if (!product) {

      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });

    }

    const variant = product.variants.id(variantId);

    if (!variant) {

      return res.status(404).json({
        success: false,
        message: 'Variant not found'
      });

    }

    // if (variant.quantity < quantity) {

    //   return res.status(400).json({
    //     success: false,
    //     message: `Only ${variant.quantity} items left`
    //   });

    // }

    let cart = await Cart.findOne({ email });

    if (!cart) {

      cart = new Cart({
        email,
        items: [{
          productId,
          variantId,
          quantity
        }]
      });

    } else {

      const existingItem = cart.items.find(
        item =>
          item.productId.toString() === productId &&
          item.variantId.toString() === variantId
      );

      if (existingItem) {

        const newQty = existingItem.quantity + quantity;

        if (newQty > variant.quantity) {

          return res.status(400).json({
            success: false,
            message: `Only ${variant.quantity} items available`
          });

        }

        existingItem.quantity = newQty;

      } else {

        cart.items.push({
          productId,
          variantId,
          quantity
        });

      }

    }

    await cart.save();

    res.status(200).json({
      success: true,
      message: 'Item added to cart.'
    });

 } catch (error) {
  console.error("Error adding to cart:", error);

res.status(500).json({
  success: false,
  message: error.message || "Something went wrong. Please try again."
});
}

});

app.get('/api/fetchcart/:email', async (req, res) => {
  try {
    const { email } = req.params;

    let cart = await Cart.findOne({ email }).populate('items.productId');

    if (!cart || cart.items.length === 0) {
      return res.status(200).json({
        cart: [],
        subtotal: 0,
        totalBeforePromo: 0,
        couponDiscount: 0,
        finalTotal: 0,
        youSaved: 0,
        coupon: null
      });
    }

    // ====================== CALCULATE CART ITEMS ======================
    let totalBeforePromo = 0;

    const formattedCart = cart.items
      .filter(item => item.productId)
      .map(item => {
        const prod = item.productId;
        const variant = prod.variants.id(item.variantId);

        if (!variant) return null;

        const originalPrice = prod.originalPrice || 0;
        const discountPrice = prod.discountedPrice || originalPrice;

        const lineTotal = discountPrice * item.quantity;
        totalBeforePromo += lineTotal;

        return {
          productId: prod._id,
          variantId: item.variantId,
          title: prod.title,
          image: prod.mainImage,
          originalPrice,
          discountPrice,
          quantity: item.quantity,
          color: variant.color,
          size: variant.size,
          availableQuantity: variant.quantity
        };
      })
      .filter(Boolean);

    // ====================== VALIDATE & CLEAN COUPON ======================
    let validCoupon = null;

    if (cart.coupon?.code) {

      const dbCoupon = await Coupon.findOne({
        code: cart.coupon.code,
        active: true
      });

      const now = new Date();

      const invalidCoupon =
        !dbCoupon ||
        (dbCoupon.startDate && now < dbCoupon.startDate) ||
        (dbCoupon.expiryDate && now > dbCoupon.expiryDate) ||
        (dbCoupon.usedCount >= dbCoupon.totalUsageLimit) ||
        (totalBeforePromo < dbCoupon.minOrderAmount);

      if (invalidCoupon) {

        cart.coupon = null;
        await cart.save();

      } else {

        validCoupon = dbCoupon;

      }
    }

    // ====================== CALCULATE COUPON DISCOUNT ======================
    let couponDiscount = 0;

    if (validCoupon) {

      if (validCoupon.discountType === 'percent') {

        couponDiscount =
          (totalBeforePromo * validCoupon.discountValue) / 100;

        if (validCoupon.maxDiscount) {
          couponDiscount = Math.min(
            couponDiscount,
            validCoupon.maxDiscount
          );
        }

      } else {

        couponDiscount = validCoupon.discountValue;

      }
    }

    const finalTotal = Math.max(
      0,
      totalBeforePromo - couponDiscount
    );

    const youSaved = totalBeforePromo - finalTotal;

    res.status(200).json({
      cart: formattedCart,
      subtotal: totalBeforePromo,
      totalBeforePromo,
      couponDiscount,
      finalTotal,
      youSaved,

      coupon: validCoupon
        ? {
            code: validCoupon.code,
            discountType: validCoupon.discountType,
            discountValue: validCoupon.discountValue,
            maxDiscount: validCoupon.maxDiscount
          }
        : null
    });

  } catch (err) {
    console.error('Fetch cart error:', err);
    res.status(500).json({
      message: 'Server error.'
    });
  }
});



app.get('/api/cart-count/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const cart = await Cart.findOne({ email });

    const count = cart?.items?.reduce((acc, item) => acc + item.quantity, 0) || 0;

    res.status(200).json({ success: true, count });
  } catch (err) {
    console.error('Cart count fetch error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


app.delete('/api/removefromcart', async (req, res) => {

  try {

    const {
      email,
      productId,
      variantId
    } = req.body;

    const cart = await Cart.findOne({ email });

    if (!cart) {

      return res.status(404).json({
        message: 'Cart not found'
      });

    }

    cart.items = cart.items.filter(item => {

      return !(

        item.productId.toString() === productId &&
        item.variantId.toString() === variantId.toString()

      );

    });

    // Revalidate coupon after item removal
    await revalidateCartCoupon(cart);

    await cart.save();

    res.status(200).json({
      message: 'Item removed from cart.'
    });

  } catch (err) {

    console.error('Remove from cart error:', err);

    res.status(500).json({
      message: 'Server error.'
    });

  }

});
app.put('/api/updatecart', async (req, res) => {
  try {

    const {
      email,
      productId,
      variantId,
      quantity
    } = req.body;

    const cart = await Cart.findOne({ email });

    if (!cart) {
      return res.status(404).json({
        message: 'Cart not found'
      });
    }

    // Find product
    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({
        message: 'Product not found'
      });
    }

    // Find variant
    const variant = product.variants.id(variantId);

    if (!variant) {
      return res.status(404).json({
        message: 'Variant not found'
      });
    }

    // Stock validation
    if (quantity > variant.quantity) {
      return res.status(400).json({
        message: `Only ${variant.quantity} items available`
      });
    }

    // Find cart item
    const item = cart.items.find(
      item =>
        item.productId.toString() === productId &&
        item.variantId.toString() === variantId.toString()
    );

    if (!item) {
      return res.status(404).json({
        message: 'Item not found in cart'
      });
    }

    item.quantity = quantity;

    // Revalidate coupon after quantity change
    await revalidateCartCoupon(cart);

    await cart.save();

    res.status(200).json({
      message: 'Cart updated'
    });

  } catch (err) {

    console.error('Update cart error:', err);

    res.status(500).json({
      message: 'Server error.'
    });

  }
});

const orderSchema = new mongoose.Schema({
  email: { type: String, required: true },
  orderNumber: {
    type: String,
    required: true,
    unique: true,
  },

  billing: {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    country: { type: String, required: true },
    addressLine1: { type: String, required: true },
    addressLine2: { type: String },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zip: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true },
  },

  items: [
    {
      productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
      title: String,
      originalPrice: Number,
      quantity: Number,
      discountPrice: Number,
      finalPaidAmount: {
  type: Number,
  default: 0,
},
    variantId: {
  type: mongoose.Schema.Types.ObjectId,
},

variant: {
  color: String,
  size: String,
},
      status: {
        type: String,
        enum: ["Pending", "Confirmed", "Cancelled", "Shipped", "Delivered", "Returned", "Return Requested"],
        default: "Pending",
      },
      isCancelled: { type: Boolean, default: false },
      cancellationReason: String,
      cancelledAt: Date,

      isReturned: { type: Boolean, default: false },
      returnReason: String,
      returnedAt: Date,
      returnInspected: {
  type: Boolean,
  default: false,
},

 refundStatus: {
  type: String,
  enum: [
    "Pending",
    "Processing",
    "Refunded",
    "Processed",
    "Failed",
    "Already Refunded",
    "Not Applicable",
  ],
  default: "Pending",
},
      bankDetails: {
        accountHolderName: { type: String },
        accountNumber: { type: String },
        ifscCode: { type: String },
        upiId: { type: String },
      },
      refundMethod: {
        type: String,
        enum: ["Razorpay", "Manual", "Cash", "UPI"],
        default: "Razorpay"
      },
 refundId: String,
refundCreatedAt: Date,
refundAmount: Number,

refundProcessing: {
  type: Boolean,
  default: false,
},
stockRestored: {
  type: Boolean,
  default: false,
},
refundIdempotencyKey: {
  type: String,
  default: null,
},
refundRequestedAmount: {
  type: Number,
  default: null,
},
    }
  ],
  coupon: {
  code: String,
  discountType: String,
  discountValue: Number
}, 

  totalBeforeDiscount: Number,
  totalAfterDiscount: Number,
  promoDiscount: Number,
  finalTotal: Number,
  note: String,

  paymentMode: { type: String, enum: ["razorpay", "cod"], required: true },
  orderSource: {
  type: String,
  enum: ["CART", "BUY_NOW"],
  default: "CART",
},
  status: {
    type: String,
    enum: ["Pending", "Confirmed", "Cancelled", "Shipped", "Delivered", "Returned"],
    default: "Pending",
  },

  razorpayOrderId: String,
  isPaid: { type: Boolean, default: false },
  paymentProcessing: {
  type: Boolean,
  default: false,
},
  paidAt: Date,

  paymentInfo: {
    id: String,
    method: String,
    status: String,
  },

  deliveryCharge: {
    type: Number,
    default: 0,
  },
shiprocketOrderId: String,
shiprocketShipmentId: String,   // rename this

awbCode: String,
courierName: String,

trackingUrl: String,

shippingStatus: {
  type: String,
  enum: [
    "Pending",
    "Processing",
    "Shipped",
    "Delivered",
    "Returned",
    "Cancelled", 
    "Failed"
  ],
  default: "Pending"
},
pickupScheduled: {
  type: Boolean,
  default: false,
},

pickupScheduledAt: {
  type: Date,
  default: null,
},

pickupTokenNumber: {
  type: String,
  default: null,
},
manifestUrl: {
  type: String,
  default: null,
},

manifestGenerated: {
  type: Boolean,
  default: false,
},
labelUrl: {
  type: String,
  default: null,
},

labelGenerated: {
  type: Boolean,
  default: false,
},
isTestOrder: {
  type: Boolean,
  default: false
}, 

  createdAt: { type: Date, default: Date.now },

// === REFUND HANDLING ===
totalRefunded: {
  type: Number,
  default: 0,
},
totalRefundable: {
  type: Number,
  default: 0,
},

// Order-level lock to prevent concurrent refunds
refundProcessing: {
  type: Boolean,
  default: false,
},
refundLockVariantId: {
  type: String,
  default: null,
},

});



const Order = mongoose.model("Order", orderSchema, "Order");

app.post("/api/create-razorpay-order", async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        message: "Order ID is required",
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    if (order.isPaid) {
      return res.status(400).json({
        message: "This order has already been paid",
      });
    }

    // Calculate the amount on the backend in paise.
    const payableAmount =
      Number(order.finalTotal) + Number(order.deliveryCharge || 0);

    const amountInPaise = Math.round(payableAmount * 100);

    if (!Number.isFinite(amountInPaise) || amountInPaise <= 0) {
      return res.status(400).json({
        message: "Invalid order amount",
      });
    }

    // Reuse the existing Razorpay order if one was already created.
    if (order.razorpayOrderId) {
      const existingRazorpayOrder =
        await razorpay.orders.fetch(order.razorpayOrderId);

      return res.status(200).json(existingRazorpayOrder);
    }

    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: order.orderNumber,
    });

    order.razorpayOrderId = razorpayOrder.id;
    await order.save();

    return res.status(200).json(razorpayOrder);
  } catch (error) {
    console.error(
      "Razorpay order creation error:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      message: "Razorpay order creation failed",
    });
  }
});

app.post("/api/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderId,
      paymentMethod,
    } = req.body;

    if (!orderId) {
      return res.status(400).json({ message: "Missing orderId" });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

if (order.isPaid) {
  return res.status(400).json({
    success: false,
    message: "Order already paid",
  });
}


    
if (!order.razorpayOrderId) {
  return res.status(400).json({
    success: false,
    message: "No Razorpay order is linked to this order.",
  });
}

if (order.razorpayOrderId !== razorpay_order_id) {
  return res.status(400).json({
    success: false,
    message: "Razorpay order does not match the database order.",
  });
}

// Verify the expected amount using the server-side order total
const expectedAmountPaise = Math.round(
  (Number(order.finalTotal) + Number(order.deliveryCharge || 0)) * 100
);

try {
  const razorpayOrder = await razorpay.orders.fetch(
    razorpay_order_id
  );

  if (
    razorpayOrder.amount !== expectedAmountPaise ||
    razorpayOrder.currency !== "INR"
  ) {
    return res.status(400).json({
      success: false,
      message: "Payment amount mismatch",
    });
  }
} catch (err) {
  console.error(
    "Razorpay order verification error:",
    err.message
  );

  return res.status(400).json({
    success: false,
    message: "Unable to verify Razorpay order",
  });
}

    // ================= SIGNATURE VERIFY =================
    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Invalid signature",
      });
    }
const lockedOrder = await Order.findOneAndUpdate(
  {
    _id: order._id,
    isPaid: false,
    paymentProcessing: false,
  },
  {
    $set: { paymentProcessing: true },
  },
  { new: true }
);
if (!lockedOrder) {
  return res.status(409).json({
    success: false,
    message: "Payment verification is already in progress. Please try again shortly.",
  });
}


    // ================= STOCK REDUCTION =================
    const stockDeductions = [];

    try {
      for (const item of order.items) {
        const quantity = Number(item.quantity);

        if (!Number.isInteger(quantity) || quantity <= 0) {
          throw new Error(`Invalid quantity for ${item.title}`);
        }

        // Atomically reduce stock only when sufficient stock exists.
        const updatedProduct = await Product.findOneAndUpdate(
          {
            _id: item.productId,
            variants: {
              $elemMatch: {
                _id: item.variantId,
                quantity: { $gte: quantity },
              },
            },
          },
          {
            $inc: {
              "variants.$.quantity": -quantity,
            },
          },
          { new: true }
        );

        if (!updatedProduct) {
          const productExists = await Product.exists({
            _id: item.productId,
          });

          if (!productExists) {
            throw new Error(`${item.title} not found`);
          }

          throw new Error(
            `Insufficient stock or missing variant for ${item.title}`
          );
        }

        stockDeductions.push({
          productId: item.productId,
          variantId: item.variantId,
          quantity,
        });
      }
    } catch (stockError) {
      // Restore any stock already deducted by this attempt.
      for (const deduction of stockDeductions.reverse()) {
        await Product.updateOne(
          {
            _id: deduction.productId,
            variants: {
              $elemMatch: { _id: deduction.variantId },
            },
          },
          {
            $inc: {
              "variants.$[variant].quantity": deduction.quantity,
            },
          },
          {
            arrayFilters: [
              { "variant._id": deduction.variantId },
            ],
          }
        ).catch((rollbackError) => {
          console.error(
            "CRITICAL: Stock rollback failed:",
            rollbackError.message
          );
        });
      }

      await Order.updateOne(
        { _id: order._id, isPaid: false },
        { $set: { paymentProcessing: false } }
      );

      console.error("Stock deduction failed:", stockError.message);

      return res.status(400).json({
        success: false,
        message:
          "We could not reserve all items in this order. Please contact support before retrying if your payment was deducted.",
      });
    }



// ================= UPDATE ORDER =================
order.isPaid = true;
order.paymentProcessing = false;
order.paidAt = new Date();
order.status = "Confirmed";

    order.paymentInfo = {
      id: razorpay_payment_id,
      method: paymentMethod || "razorpay",
      status: "success",
    };

    await order.save();
    console.log("PAYMENT SAVED:", {
  orderId: order._id.toString(),
  isPaid: order.isPaid,
  paymentProcessing: order.paymentProcessing,
});

    // ================= MARK COUPON AS USED - IMPROVED =================
    if (order.coupon?.code) {
      try {
        const couponCode = order.coupon.code;

        // 1. Increment global usage count
        await Coupon.findOneAndUpdate(
          { code: couponCode },
          { $inc: { usedCount: 1 } }
        );

        // 2. Increment user's usage count (if exists)
        const incrementResult = await User.findOneAndUpdate(
          { 
            email: order.email, 
            "usedCoupons.couponCode": couponCode 
          },
          { 
            $inc: { "usedCoupons.$.count": 1 } 
          }
        );

        // 3. If user is using this coupon for the first time, add new entry
        if (!incrementResult) {
          await User.findOneAndUpdate(
            { email: order.email },
            {
              $push: {
                usedCoupons: {
                  couponCode: couponCode,
                  count: 1
                }
              }
            }
          );
        }

        console.log(`✅ Coupon ${couponCode} usage updated successfully`);
      } catch (couponErr) {
        console.error("Coupon usage marking failed:", couponErr.message);
        // Do not fail the payment flow
      }
    }

    // ================= SHIPROCKET =================
    try {
      await shipOrderToShiprocket(order._id);
    } catch (err) {
      console.log("Shiprocket error:", err.message);
      order.shippingStatus = "Failed";
      await order.save().catch(() => {});
    }

    // ================= CLEAR CART =================
    await Cart.findOneAndUpdate(
      { email: order.email },
      { $set: { items: [], coupon: null } }
    ).catch(err => console.log("Cart clear warning:", err.message));

    return res.status(200).json({
      success: true,
      message: "Payment verified and order confirmed",
    });

} catch (error) {
  console.error("Verify payment error:", error);

  // Release the lock only if payment has not been confirmed.
  if (req.body?.orderId) {
    await Order.updateOne(
      {
        _id: req.body.orderId,
        isPaid: false,
        paymentProcessing: true,
      },
      {
        $set: { paymentProcessing: false },
      }
    ).catch((unlockError) => {
      console.error(
        "Failed to release payment lock:",
        unlockError.message
      );
    });
  }

  return res.status(500).json({
    success: false,
    message: "Payment verification failed",
  });
}
});
app.post("/api/validate-order", async (req, res) => {
  try {
    const { email, password, buyNowItem } = req.body;

    // 1. Check user
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    // 2. Check password
    const isValidPassword = await user.comparePassword(password);

    if (!isValidPassword) {
      return res.status(401).json({
        message: "Incorrect password",
      });
    }

    // =========================
    // BUY NOW VALIDATION
    // =========================
    if (buyNowItem) {
      const product = await Product.findById(
        buyNowItem.productId
      );

      if (!product) {
        return res.status(400).json({
          message: "Product not found",
        });
      }

      const variant = product.variants.id(
        buyNowItem.variantId
      );

      if (!variant) {
        return res.status(400).json({
          message: "Variant not found",
        });
      }

      if (variant.quantity < buyNowItem.quantity) {
        return res.status(400).json({
          message: `Only ${variant.quantity} left in stock`,
        });
      }
    }

    // =========================
    // CART VALIDATION
    // =========================
    else {
      const cartData = await Cart.findOne({ email }).populate(
        "items.productId"
      );

      if (!cartData || cartData.items.length === 0) {
        return res.status(400).json({
          message: "Cart is empty",
        });
      }

      for (const item of cartData.items) {
        const product = item.productId;

        if (!product) {
          return res.status(400).json({
            message: "Some products unavailable",
          });
        }

        const variant = product.variants.id(
          item.variantId
        );

        if (!variant) {
          return res.status(400).json({
            message: `Variant unavailable for ${product.title}`,
          });
        }

        if (variant.quantity < item.quantity) {
          return res.status(400).json({
            message: `Only ${variant.quantity} left for ${product.title}`,
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
    });

  } catch (err) {
    console.log(err);

    return res.status(500).json({
      message: "Validation failed",
    });
  }
});

app.post("/api/placeorder", async (req, res) => {
  try {
   const {
  email,
  billingDetails,
  password,
  note,
  paymentMode,
  buyNowItem,
  razorpayOrderId,
} = req.body;

    // ================= USER VALIDATION =================
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) return res.status(401).json({ message: "Incorrect password" });

    let totalBefore = 0;      // Original price total (for "You Saved")
    let totalAfter = 0;       // After product discount but before coupon
    let promoDiscount = 0;
    let appliedCoupon = null;
    const orderItems = [];

    // ====================================================
    // BUY NOW FLOW (No coupon support)
    // ====================================================
    if (buyNowItem) {
      const product = await Product.findById(buyNowItem.productId);
      if (!product) return res.status(400).json({ message: "Product not found" });

      const variant = product.variants.id(buyNowItem.variantId);
      if (!variant) return res.status(400).json({ message: "Variant not found" });
      if (variant.quantity < buyNowItem.quantity) {
        return res.status(400).json({ message: `Only ${variant.quantity} left in stock` });
      }

      const quantity = Number(buyNowItem.quantity);
      const originalPrice = Number(product.originalPrice || 0);
      const discountedPrice = Number(product.discountedPrice || originalPrice);

      totalBefore = originalPrice * quantity;
      totalAfter = discountedPrice * quantity;

      orderItems.push({
        productId: product._id,
        variantId: variant._id,
        title: product.title,
        originalPrice,
        discountPrice: discountedPrice,
        quantity,
        finalPaidAmount: discountedPrice * quantity,
        variant: { color: variant.color, size: variant.size },
        coupon: null,
      });
    } 
    // ====================================================
    // CART FLOW - FIXED
    // ====================================================
    else {
      const cartData = await Cart.findOne({ email }).populate("items.productId");
      if (!cartData || cartData.items.length === 0) {
        return res.status(400).json({ message: "Cart is empty" });
      }

      appliedCoupon = null;

if (cartData.coupon?.code) {

  const dbCoupon = await Coupon.findOne({
    code: cartData.coupon.code,
    active: true
  });

  if (dbCoupon) {

    const now = new Date();

    const invalidCoupon =
      (dbCoupon.startDate && now < dbCoupon.startDate) ||
      (dbCoupon.expiryDate && now > dbCoupon.expiryDate) ||
      (dbCoupon.usedCount >= dbCoupon.totalUsageLimit);

    if (!invalidCoupon) {
      appliedCoupon = dbCoupon;
    }
  }
}

      let cartSubtotal = 0;   // After product discount

      // First loop: Calculate totals + build order items
      for (const cartItem of cartData.items) {
        const product = cartItem.productId;
        if (!product) return res.status(400).json({ message: "Some products unavailable" });

        const variant = product.variants.id(cartItem.variantId);
        if (!variant) return res.status(400).json({ message: `Variant unavailable for ${product.title}` });
        if (variant.quantity < cartItem.quantity) {
          return res.status(400).json({ message: `Only ${variant.quantity} left for ${product.title}` });
        }

        const quantity = Number(cartItem.quantity);
        const originalPrice = Number(product.originalPrice || 0);
        const discountedPrice = Number(product.discountedPrice || originalPrice);

        totalBefore += originalPrice * quantity;
        cartSubtotal += discountedPrice * quantity;

        orderItems.push({
          productId: product._id,
          variantId: variant._id,
          title: product.title,
          originalPrice,
          discountPrice: discountedPrice,
          quantity,
          finalPaidAmount: discountedPrice * quantity, // will adjust later if needed
          variant: { color: variant.color, size: variant.size },
        coupon: appliedCoupon ? {
  code: appliedCoupon.code,
  discountType: appliedCoupon.discountType,
  discountValue: appliedCoupon.discountValue,
  maxDiscount: appliedCoupon.maxDiscount,
  minOrderAmount: appliedCoupon.minOrderAmount
} : null,
        });
      }

      // Calculate Promo Discount
      if (appliedCoupon?.discountValue) {
        if (appliedCoupon.discountType === "percent") {
          promoDiscount = (cartSubtotal * appliedCoupon.discountValue) / 100;
          if (appliedCoupon.maxDiscount) {
            promoDiscount = Math.min(promoDiscount, appliedCoupon.maxDiscount);
          }
        } else {
          promoDiscount = appliedCoupon.discountValue;
        }
      }

      totalAfter = cartSubtotal;
      if (
  appliedCoupon &&
  cartSubtotal < appliedCoupon.minOrderAmount
) {
  appliedCoupon = null;
  promoDiscount = 0;
}
// =========================================
// DISTRIBUTE COUPON DISCOUNT TO ITEMS
// =========================================

if (promoDiscount > 0) {

  for (const item of orderItems) {

    const itemSubtotal =
      item.discountPrice * item.quantity;

    const itemCouponShare =
      (itemSubtotal / totalAfter) *
      promoDiscount;

    item.finalPaidAmount = Number(
      (itemSubtotal - itemCouponShare).toFixed(2)
    );
  }

}
else {

  for (const item of orderItems) {

    item.finalPaidAmount =
      item.discountPrice * item.quantity;

  }

}
    }

    // ====================================================
    // FINAL TOTALS
    // ====================================================
    const finalTotal = Math.max(0, totalAfter - promoDiscount);

    // ====================================================
    // DELIVERY CHARGE
    // ====================================================

const city = billingDetails.city?.trim().toLowerCase() || "";
const state = billingDetails.state?.trim().toLowerCase() || "";

let deliveryCharge = 75;

// Free delivery for Phagwara orders of ₹1,000 or more
const isPhagwaraPunjab =
  city === "phagwara" && state === "punjab";

if (isPhagwaraPunjab && finalTotal >= 1000) {
  deliveryCharge = 0;
} else {
  // Initial state-based classification for hilly regions
  const hillyStates = [
    "himachal pradesh",
    "uttarakhand",
    "jammu and kashmir",
    "jammu & kashmir",
    "ladakh",
    "sikkim",
    "arunachal pradesh",
  ];

  if (hillyStates.includes(state)) {
    deliveryCharge = 95;
  }
}


    // ====================================================
    // CREATE ORDER
    // ====================================================
    const newOrder = new Order({
      email,
      billing: {
        firstName: billingDetails.firstName,
        lastName: billingDetails.lastName,
        country: billingDetails.country,
        addressLine1: billingDetails.address,
        addressLine2: billingDetails.apartment,
        city: billingDetails.city,
        state: billingDetails.state,
        zip: billingDetails.zip,
        phone: billingDetails.phone,
        email: billingDetails.email,
      },
      items: orderItems,
   coupon: appliedCoupon ? {
  code: appliedCoupon.code,
  discountType: appliedCoupon.discountType,
  discountValue: appliedCoupon.discountValue,
  maxDiscount: appliedCoupon.maxDiscount,
  minOrderAmount: appliedCoupon.minOrderAmount
} : null,
      totalBeforeDiscount: totalBefore,
      totalAfterDiscount: totalAfter,
      promoDiscount,
      finalTotal: finalTotal,                    // Amount before delivery
      totalRefundable: finalTotal + deliveryCharge,
      note,
      paymentMode,
      orderSource: buyNowItem ? "BUY_NOW" : "CART",
      status: paymentMode === "cod" ? "Confirmed" : "Pending",
      deliveryCharge,
      razorpayOrderId: razorpayOrderId || null,
      isPaid: false,
      shippingStatus: "Pending",
      paymentInfo: {
        id: razorpayOrderId || null,
        method: paymentMode === "cod" ? "cod" : "razorpay",
        status: paymentMode === "cod" ? "pending" : "created",
      },
    });

    const shortId = newOrder._id.toString().slice(-6).toUpperCase();
    newOrder.orderNumber = `ORD-2026-${shortId}`;

    await newOrder.save();

    // ====================================================
    // STOCK REDUCTION + CART CLEAR (Only for COD)
    // ====================================================
    if (paymentMode === "cod") {
      for (const item of orderItems) {
        const product = await Product.findById(item.productId);
        if (!product) continue;
        const variant = product.variants.id(item.variantId);
        if (!variant) continue;

        variant.quantity -= item.quantity;
        if (variant.quantity < 0) variant.quantity = 0;
        await product.save({ validateBeforeSave: false });
      }

      if (!buyNowItem) {
        await Cart.findOneAndUpdate(
          { email },
          { $set: { items: [], coupon: null } }
        );
      }
    }

    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      order: {
        _id: newOrder._id,
        orderNumber: newOrder.orderNumber,
      }
    });

  } catch (error) {
    console.error("Place order error:", error);
    return res.status(500).json({ message: "Failed to place order" });
  }
});



app.get('/api/uorders/:email', async (req, res) => {
  try {
    const { email } = req.params;

    const orders = await Order.find({
      email,
      $or: [
        { isPaid: true },
        { paymentMode: 'cod' },
        {
          paymentMode: { $nin: ['razorpay', 'cod'] }
        }
      ]
    })
      .sort({ createdAt: -1 })
      .populate('items.productId', 'mainImage');

    return res.status(200).json({ orders });
  } catch (error) {
    console.error("Error fetching orders:", error);
    return res.status(500).json({
      message: "Failed to fetch orders."
    });
  }
});



app.post('/api/rate/:productId', upload.single('image'), async (req, res) => {
  let uploadedPublicId = null; // track uploaded file
  try {
    const { email, rating, comment } = req.body;
    const { productId } = req.params;

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const alreadyReviewed = product.reviews.find(
      (r) => r.user.toString() === user._id.toString()
    );
    if (alreadyReviewed) {
      if (req.file) {
        await cloudinary.uploader.destroy(req.file.filename);
      }
      return res.status(400).json({ error: 'You have already reviewed this product.' });
    }

    // Track uploaded image so we can rollback if save fails
    if (req.file) {
      uploadedPublicId = req.file.filename; // Cloudinary public_id
    }

    const newReview = {
      user: user._id,
      name: user.name,
      rating: Number(rating),
      comment,
      image: req.file
        ? {
            url: req.file.path,       // Cloudinary URL
            publicId: req.file.filename, // Cloudinary public_id
          }
        : null,
    };

    product.reviews.push(newReview);
    product.numReviews = product.reviews.length;
    product.rating =
      product.reviews.reduce((acc, r) => acc + r.rating, 0) / product.numReviews;

    await product.save({ validateModifiedOnly: true });

    res.status(201).json({ message: 'Review submitted', review: newReview });
  } catch (err) {
    console.error('Submit review error:', err);

    // 🔑 Rollback Cloudinary file if review save fails
    if (uploadedPublicId) {
      try {
        await cloudinary.uploader.destroy(uploadedPublicId);
        console.log('Rolled back Cloudinary image:', uploadedPublicId);
      } catch (cloudErr) {
        console.error('Cloudinary cleanup failed:', cloudErr);
      }
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});






app.get('/api/rate/:productId/:email', async (req, res) => {
  try {
    const { productId, email } = req.params;

    // Find user
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Find product
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // Find user's review
    const review = product.reviews.find(
      r => r.user.toString() === user._id.toString()
    );

    if (!review) return res.status(404).json({ message: 'No review found' });

    return res.status(200).json({ review }); // Includes name, comment, rating, image
  } catch (err) {
    console.error('Error fetching review:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});
app.get('/api/products/:id/reviews', async (req, res) => {
  try {
    const productId = req.params.id;
    // Fetch only reviews field for performance
    const product = await Product.findById(productId).select('reviews');
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    return res.json({ reviews: product.reviews });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/return/:orderId', async (req, res) => {
  try {
    const { reason, variantId, bankDetails } = req.body;

    const order = await Order.findById(req.params.orderId);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const item = order.items.find(
      (i) => i.variantId?.toString() === variantId?.toString()
    );

    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    if (order.paymentMode !== "razorpay" && order.paymentMode !== "cod") {
      return res.status(400).json({ message: "Unsupported payment method" });
    }

    if (item.status !== "Delivered") {
      return res.status(400).json({
        message: "Only delivered items can be returned",
      });
    }

    if (item.isReturned || item.status === "Return Requested") {
      return res.status(400).json({
        message: "A return request already exists for this item",
      });
    }

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({
        message: "Please provide a return reason",
      });
    }

    // Record the request, but do NOT approve the return yet.
    item.status = "Return Requested";
    item.isReturned = false;
    item.returnReason = String(reason).trim();
    item.returnedAt = new Date();
    item.refundStatus = "Pending";
    item.refundMethod =
      order.paymentMode === "cod" ? "Manual" : "Razorpay";

    if (order.paymentMode === "cod" && bankDetails) {
      item.bankDetails = bankDetails;
    }

    await order.save();

    return res.json({
      success: true,
      message: "Return request submitted successfully. Waiting for admin approval.",
    });
  } catch (err) {
    console.error("Return Error:", err);

    return res.status(500).json({
      message: "Server error",
    });
  }
});

app.post('/api/cancel/:orderId', async (req, res) => {
  try {
    const { reason, variantId } = req.body;

    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const item = order.items.find(i => i.variantId?.toString() === variantId?.toString());
    if (!item) return res.status(404).json({ message: "Item not found" });

    if (item.isCancelled) return res.status(400).json({ message: "Already cancelled" });
    if (!["Pending", "Confirmed"].includes(item.status)) {
      return res.status(400).json({ message: "Cannot cancel at this stage" });
    }

    // Same day check
    const now = new Date();
    if (now.toDateString() !== new Date(order.createdAt).toDateString()) {
      return res.status(400).json({ message: "Cancellation allowed only on same day" });
    }

    const totalQuantity = order.items.reduce((sum, i) => sum + i.quantity, 0);
    const itemDeliveryShare = order.deliveryCharge 
      ? Math.round((order.deliveryCharge / totalQuantity) * item.quantity) 
      : 0;

    let refundAmount = item.finalPaidAmount + itemDeliveryShare;
    refundAmount = Math.max(0, refundAmount);

    if (refundAmount <= 0) {
      return res.status(400).json({ message: "Refund amount must be greater than 0" });
    }

    // Update item first
    item.status = "Cancelled";
    item.isCancelled = true;
    item.cancellationReason = reason || "";
    item.cancelledAt = now;
    item.refundAmount = refundAmount;

    let shouldRestoreStock = false;

    if (order.paymentMode === "razorpay" && order.isPaid && order.paymentInfo?.id) {
      try {
       const payment = await razorpay.payments.fetch(order.paymentInfo.id);

console.log("========== REFUND DEBUG ==========");
console.log("Payment ID:", order.paymentInfo.id);
console.log("Payment Amount:", payment.amount / 100);
console.log("Payment Status:", payment.status);
console.log("Order Final Total:", order.finalTotal);
console.log("Delivery Charge:", order.deliveryCharge);
console.log("Already Refunded:", order.totalRefunded || 0);
console.log("Refund Amount:", refundAmount);
console.log("==================================");

if (payment.status !== "captured") {
  return res.status(400).json({ message: "Payment not captured yet" });
}

const totalPaid = payment.amount / 100;
const alreadyRefunded = order.totalRefunded || 0;
const maxRefundable = totalPaid - alreadyRefunded;

if (refundAmount > maxRefundable) {
  return res.status(400).json({
    message: `Max refundable: ₹${maxRefundable}`
  });
}

const refund = await razorpay.payments.refund(order.paymentInfo.id, {
  amount: Math.round(refundAmount * 100),
});

        item.refundStatus = "Refunded";
        item.refundMethod = "Razorpay";
        item.refundId = refund.id;
        item.refundCreatedAt = new Date(refund.created_at * 1000);

        order.totalRefunded = (order.totalRefunded || 0) + refundAmount;
        shouldRestoreStock = true;

      } catch (e) {
        console.error("=== RAZORPAY REFUND ERROR ===");
        console.error("Payment ID:", order.paymentInfo.id);
        console.error("Refund Amount:", refundAmount);
        console.error("Full Error:", JSON.stringify(e, null, 2));
        
        item.refundStatus = "Failed";
        await order.save().catch(() => {});

        return res.status(400).json({
          message: e?.error?.description || e.message || "Refund failed",
          details: e?.error || null
        });
      }
    } 
    else if (order.paymentMode === "cod") {
      item.refundStatus = "Not Applicable";
      item.refundMethod = "Manual";
      shouldRestoreStock = true;
    }

    // Restore Stock
    if (shouldRestoreStock && item.variantId) {
      const product = await Product.findById(item.productId);
      if (product) {
        const variant = product.variants.id(item.variantId);
        if (variant) {
          variant.quantity += item.quantity;
          await product.save({ validateBeforeSave: false });
        }
      }
    }

    // Update order status
    if (order.items.every(i => i.isCancelled)) {
      order.status = "Cancelled";
    }

    await order.save();

    return res.status(200).json({
      success: true,
      message: "Item cancelled successfully",
      refundAmount
    });

  } catch (err) {
    console.error("Cancel Route Error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});


app.post(
  "/api/admin/refund/:orderId",
  verifyAdmin,
  async (req, res) => {
    let lockAcquired = false;
    let refundRequestStarted = false;
    let refundApiSucceeded = false;
    let lockedOrderId = null;
    let lockedVariantId = null;

    const releaseRefundLock = async () => {
      if (!lockAcquired || !lockedOrderId) return;

      await Order.updateOne(
        {
          _id: lockedOrderId,
          refundProcessing: true,
          refundLockVariantId: String(lockedVariantId),
        },
        {
          $set: {
            refundProcessing: false,
            refundLockVariantId: null,
            "items.$[item].refundProcessing": false,
          },
        },
        {
          arrayFilters: [
            {
              "item.variantId": lockedVariantId,
            },
          ],
        }
      );

      lockAcquired = false;
    };

    try {
      const { variantId, amount } = req.body;

      if (!variantId) {
        return res.status(400).json({
          message: "Variant ID is required",
        });
      }

      const order = await Order.findById(req.params.orderId);

      if (!order) {
        return res.status(404).json({
          message: "Order not found",
        });
      }

      if (order.paymentMode !== "razorpay") {
        return res.status(400).json({
          message: "Only prepaid Razorpay orders can use this refund route",
        });
      }

      if (!order.paymentInfo?.id || !order.isPaid) {
        return res.status(400).json({
          message: "No verified paid Razorpay payment exists for this order",
        });
      }

      const item = order.items.find(
        (i) =>
          i.variantId?.toString() === variantId.toString()
      );

      if (!item) {
        return res.status(404).json({
          message: "Item not found",
        });
      }


      // The item must be inspected before refund approval.
      if (
        item.status !== "Return Requested" ||
        item.isReturned
      ) {
        return res.status(400).json({
          message: "This item does not have a pending return request",
        });
      }

      if (item.returnInspected !== true) {
        return res.status(400).json({
          message: "Inspect and approve the returned item for resale before issuing a refund",
        });
      }


      if (item.refundStatus !== "Pending") {
        return res.status(409).json({
          message: `Refund cannot start. Current status: ${item.refundStatus}`,
        });
      }

      const itemPaidAmount = Number(item.finalPaidAmount);

      if (
        !Number.isFinite(itemPaidAmount) ||
        itemPaidAmount <= 0
      ) {
        return res.status(400).json({
          message: "The item's final paid amount is invalid",
        });
      }

      let refundAmount =
        amount === null || amount === undefined || amount === ""
          ? itemPaidAmount
          : Number(amount);

      if (
        !Number.isFinite(refundAmount) ||
        refundAmount <= 0 ||
        Math.round(refundAmount * 100) !== refundAmount * 100
      ) {
        return res.status(400).json({
          message: "Refund amount must be a positive amount with at most two decimal places",
        });
      }

      refundAmount = Math.round(refundAmount * 100) / 100;

      if (refundAmount > itemPaidAmount) {
        return res.status(400).json({
          message: `Refund cannot exceed the item's paid amount of ₹${itemPaidAmount.toFixed(2)}`,
        });
      }

      // Reuse an existing key and amount if an earlier attempt
      // was recorded for this same item.
      const existingKey = item.refundIdempotencyKey;
      const existingAmount = item.refundRequestedAmount;

      if (
        existingKey &&
        existingAmount != null &&
        Math.round(Number(existingAmount) * 100) !==
          Math.round(refundAmount * 100)
      ) {
        return res.status(409).json({
          message: "A previous refund attempt used a different amount. Reconcile it before trying another amount.",
        });
      }

      const idempotencyKey =
        existingKey || `refund_${crypto.randomUUID()}`;

      const requestedAmount =
        existingAmount != null
          ? Number(existingAmount)
          : refundAmount;

      // Acquire one lock for the whole order. This prevents two
      // different item refunds from checking the same balance.
      const lockedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          refundProcessing: { $ne: true },
          items: {
            $elemMatch: {
              variantId: item.variantId,
              status: "Return Requested",
              isReturned: { $ne: true },
              refundStatus: "Pending",
              refundProcessing: { $ne: true },
            },
          },
        },
        {
          $set: {
            refundProcessing: true,
            refundLockVariantId: String(item.variantId),
            "items.$.refundProcessing": true,
            "items.$.refundIdempotencyKey": idempotencyKey,
            "items.$.refundRequestedAmount": requestedAmount,
          },
        },
        { new: true }
      );

      if (!lockedOrder) {
        return res.status(409).json({
          message: "Another refund is processing, or this return is no longer eligible.",
        });
      }

      lockAcquired = true;
      lockedOrderId = lockedOrder._id;
      lockedVariantId = item.variantId;

      const refundItem = lockedOrder.items.find(
        (i) =>
          i.variantId?.toString() === variantId.toString()
      );

      if (!refundItem) {
        await releaseRefundLock();

        return res.status(404).json({
          message: "Item not found after acquiring refund lock",
        });
      }

      // Always verify the current payment with Razorpay.
      let payment;

      try {
        payment = await razorpay.payments.fetch(
          lockedOrder.paymentInfo.id
        );
      } catch (error) {
        await releaseRefundLock();
        throw error;
      }

      if (payment.status !== "captured") {
        await releaseRefundLock();

        return res.status(400).json({
          message: "Razorpay payment has not been captured",
        });
      }

      const totalPaidPaise = Number(payment.amount);
      const alreadyRefundedPaise = Number(
        payment.amount_refunded || 0
      );

      if (
        !Number.isFinite(totalPaidPaise) ||
        !Number.isFinite(alreadyRefundedPaise) ||
        totalPaidPaise <= 0
      ) {
        await releaseRefundLock();

        return res.status(400).json({
          message: "Could not verify the payment amount",
        });
      }

      // Count existing in-progress refunds as committed amounts.
      // This prevents another item from using the same balance.
      const pendingOtherRefundsPaise =
        lockedOrder.items.reduce((sum, currentItem) => {
          if (
            currentItem.variantId?.toString() ===
              variantId.toString()
          ) {
            return sum;
          }

          if (currentItem.refundStatus !== "Processing") {
            return sum;
          }

          const pendingAmount = Number(
            currentItem.refundAmount ??
              currentItem.refundRequestedAmount ??
              0
          );

          return sum + Math.round(pendingAmount * 100);
        }, 0);

      const databaseRefundedPaise = Math.round(
        Number(lockedOrder.totalRefunded || 0) * 100
      );

      const confirmedRefundedPaise = Math.max(
        alreadyRefundedPaise,
        databaseRefundedPaise
      );

      const remainingPaise =
        totalPaidPaise -
        confirmedRefundedPaise -
        pendingOtherRefundsPaise;

      const requestedPaise = Math.round(
        requestedAmount * 100
      );

      if (
        requestedPaise < 100 ||
        requestedPaise > remainingPaise
      ) {
        await releaseRefundLock();

        return res.status(400).json({
          message: `Refund exceeds the remaining refundable balance of ₹${Math.max(0, remainingPaise / 100).toFixed(2)}`,
        });
      }

      // From this point, a network failure can mean Razorpay
      // received the request even if we did not receive a response.
      refundRequestStarted = true;

      const refund = await createRazorpayRefund({
        paymentId: lockedOrder.paymentInfo.id,
        amountPaise: requestedPaise,
        idempotencyKey,
        receipt: `ret_${lockedOrder._id}_${refundItem.variantId}`,
      });

      refundApiSucceeded = true;

      // Update the FRESH, LOCKED document—not the stale original.
      refundItem.refundId = refund.id;
      refundItem.refundCreatedAt = refund.created_at
        ? new Date(refund.created_at * 1000)
        : new Date();
      refundItem.refundAmount = requestedAmount;
      refundItem.refundMethod = "Razorpay";

      if (refund.status === "processed") {
        refundItem.refundStatus = "Refunded";
        refundItem.status = "Returned";
        refundItem.isReturned = true;

        lockedOrder.totalRefunded =
          Number(lockedOrder.totalRefunded || 0) +
          requestedAmount;
} else if (refund.status === "pending") {
  refundItem.refundStatus = "Processing";

  // The physical return may have been accepted, but the
  // refund is not confirmed yet.
  refundItem.status = "Return Requested";
  refundItem.isReturned = false;
} else if (refund.status === "failed") {
        refundItem.refundStatus = "Failed";

        // The return was not completed by this failed refund.
        refundItem.status = "Return Requested";
        refundItem.isReturned = false;
      } else {
        // Unknown provider state: don't permit another refund
        // until this transaction has been reconciled.
        refundItem.refundStatus = "Processing";
        refundItem.status = "Returned";
        refundItem.isReturned = true;
      }

      refundItem.refundProcessing = false;

      // Save the item and release the order lock together.
      // If this save fails after Razorpay succeeds, preserve the
      // lock so another refund cannot use the same balance.
      if (refund.status === "processed") {
        lockedOrder.totalRefunded = Math.round(
          lockedOrder.totalRefunded * 100
        ) / 100;
      }

      lockedOrder.refundProcessing =
        refund.status === "pending" ||
        refund.status === "processed" ||
        refund.status === "failed"
          ? false
          : true;

      lockedOrder.refundLockVariantId =
        lockedOrder.refundProcessing
          ? String(refundItem.variantId)
          : null;

   
// Update the overall order status only after a confirmed refund.
if (refund.status === "processed") {
  const allItemsReturnedOrCancelled = lockedOrder.items.every(
    (currentItem) =>
      currentItem.status === "Returned" ||
      currentItem.status === "Cancelled"
  );

  if (allItemsReturnedOrCancelled) {
    lockedOrder.status = "Returned";
  }
}

await lockedOrder.save();

// Restore stock only after the refund is confirmed and
// the returned shoes have been inspected.
let stockRestoreResult = null;

if (
  refund.status === "processed" &&
  refundItem.refundStatus === "Refunded" &&
  refundItem.status === "Returned" &&
  refundItem.isReturned === true &&
  refundItem.returnInspected === true
) {
  try {
    stockRestoreResult = await restoreReturnedItemStock(
      lockedOrder._id,
      refundItem.variantId
    );

    if (!stockRestoreResult?.success) {
      console.warn(
        "Refund processed, but stock restoration was not confirmed:",
        lockedOrder._id.toString(),
        refundItem.variantId.toString()
      );
    } else {
      console.log(
        "Returned item stock restored successfully:",
        lockedOrder._id.toString(),
        refundItem.variantId.toString()
      );
    }
  } catch (stockError) {
    // The refund has already succeeded. Do not report it as failed
    // or attempt to issue another refund.
    console.error(
      "Stock restoration failed after successful refund:",
      stockError
    );
  }
}

lockAcquired = lockedOrder.refundProcessing;



      return res.status(200).json({
        success: true,
        message:
          refund.status === "processed"
            ? "Refund processed successfully"
            : refund.status === "pending"
            ? "Refund initiated and is awaiting Razorpay confirmation"
            : refund.status === "failed"
            ? "Razorpay reported that the refund failed"
            : "Refund submitted; its status needs reconciliation",
        refundAmount: requestedAmount,
        refundId: refund.id,
        refundStatus: refundItem.refundStatus,
      });
    } catch (error) {
      console.error("Admin Refund Error:", error);

      // Release the lock when no refund request was sent, or when
      // Razorpay clearly rejected it with a non-conflict 4xx error.
      // Preserve it when the outcome may be uncertain.
      const definiteRejection =
        Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 409;

      if (
        lockAcquired &&
        !refundApiSucceeded &&
        (!refundRequestStarted || definiteRejection)
      ) {
        try {
          await releaseRefundLock();
        } catch (unlockError) {
          console.error(
            "Failed to release refund lock:",
            unlockError
          );
        }
      }

      return res.status(500).json({
        message:
          refundApiSucceeded
            ? "Razorpay may have accepted the refund, but the database update failed. Reconcile the refund before retrying."
            : refundRequestStarted
            ? "Refund outcome is uncertain. Do not submit another refund until the Razorpay status has been checked."
            : error?.error?.description ||
              error.message ||
              "Refund failed",
      });
    }
  }
);

app.get('/api/search', async (req, res) => {
  const { q, minPrice, maxPrice, sizes, colors } = req.query;

  if (!q) return res.json([]);

  const priceFilter = {};
  if (!isNaN(parseFloat(minPrice))) priceFilter.$gte = parseFloat(minPrice);
  if (!isNaN(parseFloat(maxPrice))) priceFilter.$lte = parseFloat(maxPrice);

  const query = {
    $and: [
      {
        $or: [
          { title: { $regex: q, $options: 'i' } },
          { description: { $regex: q, $options: 'i' } },
          { brand: { $regex: q, $options: 'i' } },
          { category: { $regex: q, $options: 'i' } }
        ]
      },
      ...(Object.keys(priceFilter).length > 0
        ? [{ discountedPrice: priceFilter }]
        : [])
    ]
  };

  // Add size filter if provided
  if (sizes) {
    const sizesArray = sizes.split(',');
    query.$and.push({ sizes: { $in: sizesArray } });
  }

  // Add color filter if provided
  if (colors) {
    const colorsArray = colors.split(',');
    query.$and.push({ colors: { $in: colorsArray } });
  }

  try {
    const results = await Product.find(query).limit(10);
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Server error during search' });
  }
});


app.get('/api/category-counts', async (req, res) => {
  try {
    const counts = await Product.aggregate([
      { $group: { _id: "$category", count: { $sum: 1 } } }
    ]);

    const formatted = {};
    counts.forEach(({ _id, count }) => {
      formatted[_id] = count;
    });

    res.json(formatted); // { women: 12, men: 8, kids: 6, handbags: 3, accessories: 10 }
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch category counts' });
  }
});
const adminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  adminname: { type: String, required: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ['superadmin', 'admin'],
    default: 'admin'
  }
}, { timestamps: true });

adminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

adminSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const Admin=mongoose.model("Admin", adminSchema, "Admin")
app.post('/api/adminregister', async (req, res) => {
  try {
    const { email, password, adminname } = req.body;

    // Check if superadmin already exists
    const superadminExists = await Admin.findOne({ role: 'superadmin' });
    if (superadminExists) {
      return res.status(403).json({ error: 'Superadmin already exists' });
    }

    // Check if admin with email already exists
    const exists = await Admin.findOne({ email });
    if (exists) {
      return res.status(400).json({ error: 'Admin already exists' });
    }

    // Create new admin with role superadmin
    const newAdmin = new Admin({
      email,
      password,
      adminname,
      role: 'superadmin', // Force superadmin only for this route
    });

    await newAdmin.save();

    res.status(201).json({ message: 'Superadmin registered successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

app.post('/api/adminlogin', async (req, res) => {
  try {
    const { email, password } = req.body;

    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      {
        id: admin._id,
        email: admin.email,
        role: admin.role,
        adminname: admin.adminname
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    // 🔽 Just send plain token
    res.json({ token });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
});


app.get('/api/admin/products/all', verifyAdmin, async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 }); // optional sort

    res.status(200).json(products);
  } catch (err) {
    console.error('Admin Fetch All Products Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
app.put(
  '/api/products/updatevariantstock/:productId/:variantId',
  async (req, res) => {
    try {
      const { quantity } = req.body;

      const product = await Product.findById(
        req.params.productId
      );

      if (!product) {
        return res.status(404).json({
          message: 'Product not found'
        });
      }

      const variant = product.variants.id(
        req.params.variantId
      );

      if (!variant) {
        return res.status(404).json({
          message: 'Variant not found'
        });
      }

      variant.quantity = Number(quantity);

      await product.save();

      res.status(200).json({
        success: true,
        message: 'Stock updated',
        product
      });

    } catch (err) {
      console.error(err);

      res.status(500).json({
        message: 'Server error'
      });
    }
  }
);
app.get('/api/adminproducts/:id', verifyAdmin, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).lean();

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (err) {
    console.error('Error fetching product by ID:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
app.get('/api/admincategories', async (req, res) => {
  try {
    const defaultCategories = ["men", "women", "kids", "handbags", "accessories"];

    // Get distinct categories from products
    let categoriesFromDB = await Product.distinct("category");

    // Merge and remove duplicates
    let allCategories = [...new Set([...categoriesFromDB, ...defaultCategories])];

    res.status(200).json(allCategories);
  } catch (err) {
    console.error("Error fetching categories:", err);
    res.status(500).json({ message: "Server error while fetching categories" });
  }
});

const deleteFileIfExists = (filePath) => {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`Deleted: ${filePath}`);
  } else {
    console.log(`File not found: ${filePath}`);
  }
};

app.delete('/api/deleteproduct/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    // Delete mainImage from Cloudinary
    if (product.mainImage?.publicId) {
      await cloudinary.uploader.destroy(product.mainImage.publicId);
    }

    // Delete otherImages
    if (Array.isArray(product.otherImages)) {
      for (const img of product.otherImages) {
        if (img.publicId) {
          await cloudinary.uploader.destroy(img.publicId);
        }
      }
    }

    // Delete review images
    if (Array.isArray(product.reviews)) {
      for (const rev of product.reviews) {
        if (rev.image?.publicId) {
          await cloudinary.uploader.destroy(rev.image.publicId);
        }
      }
    }

    await product.deleteOne();
    res.status(200).json({ success: true, message: 'Product and images deleted.' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ success: false, message: 'Server error during deletion.' });
  }
});

app.put(
  "/api/products/:id",
  productUpload.fields([
    { name: "mainImage", maxCount: 1 },
    { name: "otherImages", maxCount: 4 },
  ]),
  async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Parse variants from frontend
      let variants = [];
      if (req.body.variants) {
        variants = JSON.parse(req.body.variants);
      }

      const updatedFields = {
        title: req.body.title,
        brand: req.body.brand,
        category: req.body.category,
        description: req.body.description,
        originalPrice: Number(req.body.originalPrice),
        discountedPrice: Number(req.body.discountedPrice),
        promoCode: req.body.promoCode || null,
        promoDiscountPercent: Number(req.body.promoDiscountPercent || 0),
        label: req.body.label,
        specifications: req.body.specifications,
        variants: variants,   // ← Important: Update variants
      };

      // 🔹 Handle Main Image Update
      if (req.files["mainImage"] && req.files["mainImage"][0]) {
        // Delete old main image
        if (product.mainImage?.publicId) {
          await cloudinary.uploader.destroy(product.mainImage.publicId);
        }

        const newMain = req.files["mainImage"][0];
        updatedFields.mainImage = {
          url: newMain.path || newMain.secure_url || newMain.url,
          publicId: newMain.filename || newMain.public_id,
        };
      }

      // 🔹 Handle Other Images (Replace all if new ones are uploaded)
      if (req.files["otherImages"] && req.files["otherImages"].length > 0) {
        // Delete old other images
        if (product.otherImages?.length) {
          for (const img of product.otherImages) {
            if (img.publicId) await cloudinary.uploader.destroy(img.publicId);
          }
        }

        updatedFields.otherImages = req.files["otherImages"].map((file) => ({
          url: file.path || file.secure_url || file.url,
          publicId: file.filename || file.public_id,
        }));
      }

      // Update product
      const updatedProduct = await Product.findByIdAndUpdate(
        req.params.id,
        updatedFields,
        { new: true, runValidators: true }
      );

      return res.json({
        success: true,
        message: "Product updated successfully",
        product: updatedProduct,
      });

    } catch (err) {
      console.error("Product Update Error:", err);
      return res.status(500).json({ 
        error: "Failed to update product",
        details: err.message 
      });
    }
  }
);




app.get('/api/admin/orders', async (req, res) => {
  try {
    const orders = await Order.find()
      .sort({ createdAt: -1 }) // newest first
      .populate('items.productId', 'mainImage'); // populate image only

    res.status(200).json({ orders });
  } catch (error) {
    console.error("Error fetching admin orders:", error);
    res.status(500).json({ message: 'Failed to fetch orders', error });
  }
});
app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ message: 'Status updated', order });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});
app.get('/api/users', async (req, res) => {
  const users = await User.find({}, 'name email phone role');
  res.json(users);
});
app.delete('/api/users/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.put("/api/orders/:orderId/item/:itemIndex/status", async (req, res) => {
  const { orderId, itemIndex } = req.params;
  const { status } = req.body;

  try {
    const allowedStatuses = [
      "Pending",
      "Confirmed",
      "Shipped",
      "Delivered",
    ];

    // Validate requested status
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid status. Cancellation and returns must use their dedicated workflows.",
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const index = Number(itemIndex);

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= order.items.length
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid item index",
      });
    }

    const item = order.items[index];

    // Don't allow fulfilment updates for failed or unpaid
    // online-payment attempts.
    if (order.paymentMode === "razorpay" && !order.isPaid) {
      return res.status(400).json({
        success: false,
        message: "Cannot update fulfilment status for an unpaid order.",
      });
    }

    // Don't update items already cancelled or returned.
    if (item.isCancelled || item.isReturned) {
      return res.status(400).json({
        success: false,
        message: "Cancelled or returned items cannot be updated here.",
      });
    }

    // Don't move backwards from a completed delivery.
    if (item.status === "Delivered" && status !== "Delivered") {
      return res.status(400).json({
        success: false,
        message: "A delivered item cannot be moved to an earlier status.",
      });
    }

    item.status = status;

    await order.save();

    return res.status(200).json({
      success: true,
      message: "Item status updated successfully",
      order,
    });
  } catch (err) {
    console.error("Item status update error:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to update item status",
    });
  }
});

app.put('/api/products/updatestock/:id', async (req, res) => {
  const { quantity, stockStatus } = req.body;
  try {
    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      { quantity, stockStatus },
      { new: true }
    );
    res.json(updatedProduct);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update stock' });
  }
});
app.post('/api/admin/superadmin/addadmin', verifyAdmin, async (req, res) => {
  if (req.admin.role !== 'superadmin') {
    return res.status(403).json({ message: 'Only superadmin can add new admins' });
  }

  const { email, adminname, password } = req.body;

  if (!email || !adminname || !password) {
    return res.status(400).json({ message: 'All fields required' });
  }

  const existing = await Admin.findOne({ email });
  if (existing) {
    return res.status(409).json({ message: 'Admin already exists' });
  }

  // ❌ Remove manual hashing
  const newAdmin = new Admin({
    email,
    adminname,
    password, // will be hashed automatically by pre-save hook
    role: 'admin'
  });

  await newAdmin.save();

  res.status(201).json({ message: 'Admin created successfully' });
});

app.post('/api/admin/changepassword', async (req, res) => {
  try {
    const { email, oldPassword, newPassword } = req.body;

    if (!email || !oldPassword || !newPassword) {
      return res.status(400).json({ message: "All fields are required." });
    }

    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(404).json({ message: "Admin not found." });
    }

    const isMatch = await admin.comparePassword(oldPassword);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect." });
    }

    admin.password = newPassword;
    await admin.save();

    return res.status(200).json({ message: "Password updated successfully." });
  } catch (err) {
    console.error("Admin Change Password Error:", err);
    return res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});
// ====================== SAVED ADDRESSES APIs ======================
app.get('/api/addresses', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ 
      success: true,
      addresses: user.addresses || [] 
    });
  } catch (error) {
    console.error("Fetch addresses error:", error);
    res.status(500).json({ message: "Server error" });
  }
});
// 2. Save New Address - FIXED
app.post('/api/addresses', async (req, res) => {
  try {
    const { email, firstName, lastName, country, address, apartment, 
            city, state, zip, phone, isDefault } = req.body;

    console.log("Received data:", req.body); // ← Helpful for debugging

    if (!email || !firstName || !lastName || !address || !city || !state || !zip || !phone) {
      return res.status(400).json({ 
        message: "Missing required fields. Please check all fields." 
      });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    // Reset default flag on other addresses
    if (isDefault) {
      user.addresses.forEach(addr => addr.isDefault = false);
    }

    user.addresses.push({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      country: country || "IN",
      addressLine1: address.trim(),        // ← Mapped from frontend 'address'
      addressLine2: apartment ? apartment.trim() : "",  // ← Mapped from frontend 'apartment'
      city: city.trim(),
      state: state.trim(),
      zip: zip.trim(),
      phone: phone.trim(),
      isDefault: isDefault || (user.addresses.length === 0)
    });

    await user.save();

    res.json({ 
      success: true,
      message: "Address saved successfully", 
      addresses: user.addresses 
    });
  } catch (error) {
    console.error("Save address error:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to save address",
      error: error.message 
    });
  }
});
// 3. Delete an Address
app.delete('/api/addresses/:addressId', async (req, res) => {
  try {
    const { email } = req.query;
    const { addressId } = req.params;

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    user.addresses = user.addresses.filter(addr => addr._id.toString() !== addressId);
    
    // If no default left, make first address default
    if (user.addresses.length > 0 && !user.addresses.some(a => a.isDefault)) {
      user.addresses[0].isDefault = true;
    }

    await user.save();
    res.json({ message: "Address deleted", addresses: user.addresses });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete address" });
  }
});
app.get("/api/test-shiprocket-token", async (req, res) => {
  try {
    const token = await getShiprocketToken();
    res.json({ token });
  } catch (err) {
    console.log(err.response?.data || err);
    res.status(500).json(err.response?.data || err.message);
  }
});
app.get("/api/test-shiprocket-order/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const result = await createShiprocketOrder(order);

    res.json(result);
  } catch (err) {
    console.log(err.response?.data || err);
    res.status(500).json(err.response?.data || err.message);
  }
});
const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    unique: true,
    uppercase: true,
    required: true
  },

  discountType: {
    type: String,
    enum: ['percent', 'fixed'],
    default: 'percent'
  },

  discountValue: {
    type: Number,
    required: true
  },

  minOrderAmount: {
    type: Number,
    default: 0
  },

  maxDiscount: {
    type: Number,
    default: null
  },

  totalUsageLimit: {
    type: Number,
    default: 100
  },

  usedCount: {
    type: Number,
    default: 0
  },

  usageLimitPerUser: {
    type: Number,
    default: 1
  },

  active: {
    type: Boolean,
    default: true
  },

  startDate: Date,

  expiryDate: Date
},
{
  timestamps: true
});
const Coupon = mongoose.model('Coupon', couponSchema);
app.post('/api/apply-coupon', async (req, res) => {
  try {
    const { email, coupon: rawCode } = req.body;
    const code = rawCode?.trim().toUpperCase();

    if (!code) {
      return res.status(400).json({ message: 'Coupon code is required' });
    }

    // Fetch cart
    const cart = await Cart.findOne({ email }).populate('items.productId');
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    // Check coupon exists and active
    const couponDoc = await Coupon.findOne({ code, active: true });
    if (!couponDoc) {
      return res.status(400).json({ message: 'Invalid coupon code' });
    }

    // Fetch user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    // ================= DATE VALIDATION =================
    const now = new Date();
    if (couponDoc.startDate && now < couponDoc.startDate) {
      return res.status(400).json({ message: 'Coupon is not active yet' });
    }
    if (couponDoc.expiryDate && now > couponDoc.expiryDate) {
      return res.status(400).json({ message: 'Coupon expired' });
    }

    // ================= GLOBAL USAGE LIMIT =================
    if (couponDoc.usedCount >= couponDoc.totalUsageLimit) {
      return res.status(400).json({ message: 'Coupon usage limit reached' });
    }

    // ================= PER USER USAGE LIMIT =================
    const userUsage = user.usedCoupons.find(u => u.couponCode === code);
    const userUsedCount = userUsage ? userUsage.count : 0;

    if (userUsedCount >= couponDoc.usageLimitPerUser) {
      return res.status(400).json({
        message: `You have already used this coupon maximum times (${couponDoc.usageLimitPerUser})`
      });
    }

    // ================= MINIMUM ORDER AMOUNT =================
    const cartTotal = cart.items.reduce((sum, item) => {
      const price = item.productId.discountedPrice || item.productId.originalPrice || 0;
      return sum + (price * item.quantity);
    }, 0);

    if (cartTotal < couponDoc.minOrderAmount) {
      return res.status(400).json({
        message: `Minimum order amount ₹${couponDoc.minOrderAmount} required`
      });
    }

    // ================= APPLY COUPON TO CART =================
    cart.coupon = {
      code: couponDoc.code,
      discountType: couponDoc.discountType,
      discountValue: couponDoc.discountValue,
      maxDiscount: couponDoc.maxDiscount,
      appliedAt: new Date()
    };

    await cart.save();

    res.status(200).json({
      success: true,
      coupon: cart.coupon,
      message: 'Coupon applied successfully'
    });

  } catch (err) {
    console.error('Apply coupon error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
// Remove Coupon
app.post('/api/remove-coupon', async (req, res) => {
  try {
    const { email } = req.body;

    const cart = await Cart.findOne({ email });
    if (cart) {
      cart.coupon = null;
      await cart.save();
    }

    res.status(200).json({
      success: true,
      message: 'Coupon removed successfully'
    });
  } catch (err) {
    console.error('Remove coupon error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
app.post('/api/admin/coupons', async (req, res) => {
  try {
    const coupon = await Coupon.create(req.body);

    res.status(201).json({
      success: true,
      coupon
    });

  } catch (err) {

    res.status(500).json({
      success: false,
      message: err.message
    });

  }
});
app.get('/api/admin/coupons', async (req, res) => {
  try {

    const coupons = await Coupon.find()
      .sort({ createdAt: -1 });

    res.json(coupons);

  } catch (err) {

    res.status(500).json({
      message: err.message
    });

  }
});
app.delete('/api/admin/coupons/:id', async (req, res) => {
  try {

    await Coupon.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Coupon deleted'
    });

  } catch (err) {

    res.status(500).json({
      message: err.message
    });

  }
});
app.put('/api/admin/coupons/:id', async (req, res) => {
  try {

    const coupon = await Coupon.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    res.json(coupon);

  } catch (err) {

    res.status(500).json({
      message: err.message
    });

  }
});
app.get("/api/test", (req, res) => {
  res.json({ message: "Working" });
});

module.exports = app;
module.exports.handler = serverless(app);

