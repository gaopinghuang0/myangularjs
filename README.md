# myangularjs
Implement my own angular js based on the book *Build your own angularjs* by Tero Parviainen. The source code of the book: <https://github.com/teropa/build-your-own-angularjs/>


## Getting Started
```bash
$ npm install  # only for the first time 
$ npm test  # start Karma
# $ npm run lint  # run jshint separately, without using Karma
```

## Packages (from `Project Setup` part of the book)
1. `jshint` - JS Lint
2. `Jasmine` - Unit testing
3. `Karma` - Test runner that integrates well with `jshint`, `Jasmine`, `Browserify` and `PhantomJS`
4. `Sinon.JS` - Test helper for some of the more sophisticated mock objects e.g., HTTP features
5. `Browserify` - Bring the module capabilities to client-side code (similar to CommonJS standard for Node.js). It will pre-process all our files and output a bundle that can be run in a web browser (such as the PhantomJS browser for testing).
6. `Lo-Dash` - Array and object manipulation, such as equality checking and cloning.
7. `jQuery` - DOM query and manipulation.
