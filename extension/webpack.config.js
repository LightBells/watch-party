const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';

module.exports = {
  mode,
  devtool: mode === 'development' ? 'inline-source-map' : false,
  entry: {
    background: path.resolve(__dirname, 'src/background.ts'),
    content: path.resolve(__dirname, 'src/content.ts'),
    popup: path.resolve(__dirname, 'src/popup.ts'),
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: path.resolve(__dirname, 'manifest.json'), to: '.' },
        { from: path.resolve(__dirname, 'popup.html'), to: '.' },
        { from: path.resolve(__dirname, 'content.css'), to: '.' },
        { from: path.resolve(__dirname, 'icons'), to: 'icons' },
      ],
    }),
  ],
  optimization: {
    splitChunks: false,
  },
};
