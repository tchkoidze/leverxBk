import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

const app = express();
app.use(cors());
app.use(express.json());

const adapter = new JSONFile("users.json");
const db = new Low(adapter, { users: [] });

await db.read();
db.data ||= { users: [] };

function findUser(email) {
  return db.data.users.find((u) => u.email === email);
}

function createUserTemplate({ email, passwordHash, firstName, lastName }) {
  return {
    _id: crypto.randomUUID(),
    email,
    passwordHash,
    first_name: firstName || "",
    last_name: lastName || "",
    first_native_name: "",
    last_native_name: "",
    middle_native_name: "",
    isRemoteWork: false,
    user_avatar: "",
    department: "",
    building: "",
    room: "",
    date_birth: {
      year: null,
      month: null,
      day: null,
    },
    desk_number: 0,
    manager: {
      id: "",
      first_name: "",
      last_name: "",
    },
    phone: "",
    telegram: "",
    cnumber: "",
    citizenship: "",
    visa: [],
    role: "employee",
  };
}

function resolveManager(managerInput, currentManager, users) {
  const merged = {
    ...currentManager,
    ...managerInput,
  };

  const first = merged.first_name?.trim() || "";
  const last = merged.last_name?.trim() || "";

  const hasAnyName = first || last;
  const hasFullName = first && last;

  // CASE A: no name at all
  if (!hasAnyName) {
    return {
      id: "",
      first_name: "",
      last_name: "",
    };
  }

  // CASE C / D: full name → try to match real user

  if (hasFullName) {
    const normalize = (s = "") => s.toString().trim().toLowerCase();
    const matchedUser = users.find(
      //(u) => u.first_name === first && u.last_name === last
      (u) =>
        normalize(u.first_name) === normalize(first) &&
        normalize(u.last_name) === normalize(last)
    );

    if (matchedUser) {
      return {
        id: matchedUser._id,
        first_name: first,
        last_name: last,
      };
    }
  }

  // CASE B: partial OR full but no match
  if (!merged.id) {
    merged.id = crypto.randomUUID();
  }

  return {
    id: merged.id,
    first_name: first,
    last_name: last,
  };
}

// get all users
// app.get("/users", (req, res) => {
//   res.json(db.data.users);
// });

app.get("/users", (req, res) => {
  const { name, email, phone, telegram, building, room, department } =
    req.query;

  const lc = (str) => (str ? String(str).toLowerCase() : "");

  let users = db.data.users;

  users = users.filter((emp) => {
    const nameQuery = lc(name).trim();
    const fullNativeName = [
      emp.first_native_name,
      emp.middle_native_name,
      emp.last_native_name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesName =
      !nameQuery ||
      lc(emp._id).includes(nameQuery) ||
      lc(emp.first_name).includes(nameQuery) ||
      lc(emp.last_name).includes(nameQuery) ||
      fullNativeName.includes(nameQuery);

    const matchesEmail = !email || lc(emp.email).includes(lc(email));
    const matchesPhone = !phone || lc(emp.phone).includes(lc(phone));
    const matchesTelegram =
      !telegram || lc(emp.telegram).includes(lc(telegram));
    const matchesBuilding = !building || emp.building === building;
    const matchesRoom = !room || emp.room === room;
    const matchesDepartment = !department || emp.department === department;

    return (
      matchesName &&
      matchesEmail &&
      matchesPhone &&
      matchesTelegram &&
      matchesBuilding &&
      matchesRoom &&
      matchesDepartment
    );
  });

  res.json(users);
});

// get user by id
app.get("/users/:id", (req, res) => {
  const user = db.data.users.find((u) => u._id == req.params.id);
  if (!user) return res.status(404).json({ message: "User not found" });

  res.json(user);
});

// sign in
app.post("/sign-in", async (req, res) => {
  const { email, password } = req.body;

  const user = findUser(email);
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  res.json({
    message: "Authenticated",
    user: {
      id: user._id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      user_avatar: user.user_avatar,
      role: user.role,
    },
  });
});

// sign up

app.post("/sign-up", async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existing = db.data.users.find((u) => u.email === email);
    if (existing) {
      return res.status(400).json({ message: "User already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = createUserTemplate({
      email,
      passwordHash,
      firstName,
      lastName,
    });

    db.data.users.push(newUser);
    await db.write();

    return res.json({ message: "User created", user: email });
  } catch (err) {
    console.error("Sign-up error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// update user role
app.patch("/users/:id/role", async (req, res) => {
  const userId = req.params.id;
  const { role } = req.body;

  const allowed = ["admin", "hr", "employee"];
  if (!allowed.includes(role)) {
    return res.status(400).json({ message: "Invalid role" });
  }

  const user = db.data.users.find((u) => u._id === userId);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  user.role = role;

  await db.write();

  res.json({ message: "Role updated", user });
});

// update user info
app.patch("/users/:id", async (req, res) => {
  const userId = req.params.id;
  const updates = req.body;
  console.log("updates", updates);

  const user = db.data.users.find((u) => u._id === userId);
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  for (const key in updates) {
    const value = updates[key];
    if (value === undefined) continue;

    if (key === "manager" && typeof value === "object") {
      user.manager = resolveManager(value, user.manager, db.data.users);
      continue;
    }

    if (key === "date_birth" && typeof value === "object") {
      user.date_birth = {
        ...user.date_birth,
        ...value,
      };
      continue;
    }

    if (typeof value === "object" && value !== null) {
      user[key] = { ...user[key], ...value };
      continue;
    }

    user[key] = value;
  }

  await db.write();
  return res.json({ message: "User updated", user });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
// app.listen(3000, () => console.log("Server running on http://localhost:3000"));
