const path = require("node:path");
const CopyPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const pkg = require("./package.json");

module.exports = {
  entry: {
    content: "./src/entries/content.tsx",
    popup: "./src/entries/popup.tsx",
  },
  devtool: "source-map",
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader", "postcss-loader"],
      },
      {
        test: /\.tsx?$/,
        use: {
          loader: "ts-loader",
          options: {
            transpileOnly: true,
            compilerOptions: {
              noEmit: false,
            },
          },
        },
        exclude: /node_modules/,
      },
    ],
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
  },
  plugins: [
    new HtmlWebpackPlugin({
      filename: "popup.html",
      template: "./src/features/popup/popup.template.html",
      chunks: ["popup"],
    }),
    new CopyPlugin({
      patterns: [
        {
          from: "icons",
          to: path.resolve(__dirname, "dist", "icons"),
        },
        {
          from: "manifest.template.json",
          to: path.resolve(__dirname, "dist", "manifest.json"),
          transform(content) {
            const manifest = JSON.parse(content.toString());
            manifest.version = pkg.version;
            manifest.description = pkg.description;

            return JSON.stringify(manifest, null, 2);
          },
        },
      ],
    }),
  ],
};
