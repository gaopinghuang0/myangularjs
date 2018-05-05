
## Notes
* $watchCollection
  * define a listener function with one parameter (newValue) if oldValue is not needed, then it will not track old value and be more efficient
  * for object with length property, it may fail. For example, if obj.length = 42, and obj.length-1 (41) is also a key for obj, then the obj will be treated as array-like and be handled differently.