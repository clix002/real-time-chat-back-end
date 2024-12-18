import { PrismaClient } from "@prisma/client";
import { AuthenticationError, ForbiddenError } from "apollo-server-express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PubSub } from "graphql-subscriptions";

const pubsub = new PubSub();
const prisma = new PrismaClient();

const MESSAGE_CREATED = "MESSAGE_CREATED";

export const resolvers = {
  Subscription: {
    messageCreated: {
      subscribe: () => pubsub.asyncIterableIterator(MESSAGE_CREATED),
    },
  },
  Query: {
    users: async (_, __, { token }) => {
      if (!token) {
        throw new ForbiddenError("You are not authenticated");
      }
      return await prisma.user.findMany({
        where: {
          id: {
            not: token.id,
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    },
    messageByUser: async (_, { receiverId }, { token }) => {
      if (!token) {
        throw new ForbiddenError("You are not authenticated");
      }
      if (!receiverId) {
        throw new Error("receiverId is required");
      }
      return await prisma.message.findMany({
        where: {
          OR: [
            {
              senderId: token.id,
              receiverId,
            },
            {
              senderId: receiverId,
              receiverId: token.id,
            },
          ],
        },
        orderBy: {
          createdAt: "asc",
        },
      });
    },
  },
  Mutation: {
    signupUser: async (_, { userNew }) => {
      const user = await prisma.user.findUnique({
        where: {
          email: userNew.email,
        },
      });
      if (user) {
        throw new AuthenticationError("User already exists with this email");
      }
      const hashedPassword = await bcrypt.hash(userNew.password, 10);

      const newUser = await prisma.user.create({
        data: {
          ...userNew,
          password: hashedPassword,
        },
      });

      return newUser;
    },
    signinUser: async (_, { userSignin }) => {
      const user = await prisma.user.findUnique({
        where: {
          email: userSignin.email,
        },
      });
      if (!user) {
        throw new AuthenticationError("User does not exist with this email");
      }
      const isPasswordValid = await bcrypt.compare(
        userSignin.password,
        user.password
      );

      if (!isPasswordValid) {
        throw new AuthenticationError("Invalid password");
      }

      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
        },
        process.env.JWT_SECRET
      );

      return { token };
    },
    createMessage: async (_, { text, receiverId }, { token }) => {
      if (!token) {
        throw new ForbiddenError("You are not authenticated");
      }

      const message = await prisma.message.create({
        data: {
          text,
          senderId: token.id,
          receiverId,
        },
      });

      pubsub.publish(MESSAGE_CREATED, { messageCreated: message });

      return message;
    },
  },
};
