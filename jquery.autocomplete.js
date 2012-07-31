/**
*  Modified by Chris Olivares (v 2.0+)- June 2012.  See README for explanation of changes.
*
*  Ajax Autocomplete for jQuery, version 1.1.3
*  (c) 2010 Tomas Kirda
*
*  Ajax Autocomplete for jQuery is freely distributable under the terms of an MIT-style license.
*  For details, see the web site: http://www.devbridge.com/projects/autocomplete/jquery/
*
*  Last Review: 04/19/2010
*/

/*jslint onevar: true, evil: true, nomen: true, eqeqeq: true, bitwise: true, regexp: true, newcap: true, immed: true */
/*global window: true, document: true, clearInterval: true, setInterval: true, jQuery: true */


  /**

    Available Options

    serviceUrl:'service/autocomplete.ashx',
    minChars:2, 
    delimiter: /(,|;)\s, // regex or character
    maxHeight:400,
    width:300,
    zIndex: 9999,
    deferRequestBy: 0, //miliseconds
    params: { country:'Yes' }, //aditional parameters
    noCache: false, //default is false, set to true to disable caching
    // callback function:
    onSelect: function(value, data){ alert('You selected: ' + value + ', ' + data); },
    // local autosugest options:
    lookup: ['January', 'February', 'March', 'April', 'May'] //local lookup values 
  

    New in v 2.0 ------

    NOTE: Both of these options must be specified together!
    
    appendTo: $(selector)  //if present will append the list instead to this element. If multiple elements matched, the first one will be appended to
    watch: $(selector)  //accepts input element. encodes the contents of each element into request using uri encoded &name=value 
    fnBindElement: function //passes in the constructed div before it's appended to the dom to allow anyone to bind events to the div
      - params (div, i, autocompleteObj)  //div is a jQuery object and autocompleteObj is an instance of AutoComplete
    inline: Boolean --> This tells autocomplete whether we should just float a div around the appendTo element, or if we should insert the div as a child
                        on the specified div. When specifying inline, the list does not automatically disappear on click events like floating div does.
    
    NEW FNS:
    .register(event, fn) - an interface to register functions against events. Valid events are
      list_x ---> where x is the element before which this function should be called.
        -Function Signature -> (container, suggestions, data)
        -return value -> number. return x if no modifications to container. else return x + y where y is the number of insertions into continer, suggestion, and data objects 
      state ----> called when the server changes search states. Current states are 'normal', 'fuzzy', 'none'
      activate -----> async-- triggered when an element is activated. 
        - Function Signature -> (e, container, suggestions, data, active, index)
        - Return value -> NONE
      acscroll ---> async -> triggered when the menu scrolls
        - Function Signature -> (e, container, suggestions, data, active, index)
        - Return value -> NONE
      pre ----> sync -> triggered before any list is appended
      hide ---> async -> triggered when the results are hidden!
        - Function Signature -> ()
        - Return value -> NONE
  */

define(['jquery'], function(jQuery) {

(function($) {
  var reEscape = new RegExp('(\\' + ['/', '.', '*', '+', '?', '|', '(', ')', '[', ']', '{', '}', '\\'].join('|\\') + ')', 'g');

  function fnFormatResult(value, data, currentValue) {
    var rep = function(value, cv) {
      var pattern = '(' + cv.replace(reEscape, '\\$1') + ')';
      return value.replace(new RegExp(pattern, 'gi'), '<strong>$1<\/strong>');
    }

    if(typeof currentValue === "object"){
      keys = Object.keys(currentValue);
      for(var i = 0; i < keys.length; i++){
        cv = currentValue[keys[i]];
        if(cv.length != 0) {
          value = rep(value, currentValue[keys[i]]);
        }
      }
      return value;
    }else {
      return rep(currentValue);
    }
  }

  function Autocomplete(el, options) {
    if(options.appendTo ? !options.watch : options.watch){
     // throw new Error("Must initialize both watch and appendTo");
     return; //fail gracefully
    }
    if(options.appendTo){
      this.el = options.appendTo;
      this.inputs = options.watch;
    }else{
      this.el = el;
      this.inputs = el;
    }
    this.el.attr('autocomplete', 'off');
    this.suggestions = [];
    this.data = [];
    this.eventHandlers = {}
    this.badQueries = [];
    this.selectedIndex = -1;
    this.intervalId = 0;
    this.cachedResponse = {};
    this.onChangeInterval = null;
    this.ignoreValueChange = false;
    this.serviceUrl = options.serviceUrl;
    this.isLocal = false;
    this.options = {
      autoSubmit: false,
      minChars: 1,
      maxHeight: 300,
      deferRequestBy: 0,
      width: 0,
      highlight: true,
      queryWord: 'query',
      params: {},
      fnFormatResult: fnFormatResult,
      fnBindElement: null,
      delimiter: null,
      zIndex: 9999,
      inline: false,
      clearCache: 0,
      overlay: null
    };
    this.initialize(options);
    this.setOptions(options);    //Set options first so we can correctly set the correct currentValue
    if(this.options.clearCache != 0){ me = this;this.cacheClearInterval = setInterval(function(){me.clearCache();}, this.options.clearCache*1000);}
    this.currentValue = this.getQuery();
  }
  
  $.fn.autocomplete = function(options) {
    return new Autocomplete(this.get(0)||$('<input />'), options);
  };


  Autocomplete.prototype = {

    killerFn: null,

    initialize: function(options) {

      var me, uid, autocompleteElId;
      me = this;
      uid = Math.floor(Math.random()*0x100000).toString(16);
      autocompleteElId = 'Autocomplete_' + uid;

      this.killerFn = function(e) {
        if ($(e.target).parents('.autocomplete').size() === 0) {
          me.killSuggestions();
          me.disableKillerFn();
        }
      };

      if (!this.options.width) { this.options.width = this.el.width(); }
      this.mainContainerId = 'AutocompleteContainer_' + uid;

      $('<div id="' + this.mainContainerId + '" class="autocomplete_parent"><div class="autocomplete-w1"><div class="autocomplete" id="' + autocompleteElId + '" style="display:none; width:300px;"></div></div></div>').appendTo('body');

      this.container = $('#' + autocompleteElId);
      if (window.opera) {
        this.inputs.keypress(function(e) { me.onKeyPress(e); });
      } else {
        this.inputs.keydown(function(e) { me.onKeyPress(e); });
      }
      this.inputs.keyup(function(e) { me.onKeyUp(e); });
      if(options.inline) {
        this.el.append(this.container);
        this.inputs.focus(function() { 
          me.fixPosition(); 
          me.ignoreValueChange = false;  //Always set false for now...thinking of registering a focus handle?
          me.onValueChange();
        });
      }else{
        this.inputs.blur(function() { me.enableKillerFn(); });
        this.fixPosition();
        this.inputs.focus(function() { me.fixPosition(); this.onValueChange();});
      }
    },
    
    setOptions: function(options){
      var o = this.options;
      $.extend(o, options);
      if(o.lookup){
        this.isLocal = true;
        if($.isArray(o.lookup)){ o.lookup = { suggestions:o.lookup, data:[] }; }
      }
      $('#'+this.mainContainerId).css({ zIndex:o.zIndex });
      this.container.css({ maxHeight: o.maxHeight + 'px', width:o.width });
    },

    trigger: function(evnt, params){
      setTimeout(function(){$(window).trigger(evnt, params)}, 1);
    },
    
    clearCache: function(){
      this.cachedResponse = {};
      this.badQueries = [];
    },
    
    disable: function(){
      this.disabled = true;
    },
    
    enable: function(){
      this.disabled = false;
    },

    fixPosition: function() {
      var offset = this.el.offset();
      $('#' + this.mainContainerId).css({ top: (offset.top + this.el.innerHeight()) + 'px', left: offset.left + 'px' });
    },

    reposition: function() {
      this.fixPosition();
    },

    enableKillerFn: function() {
      var me = this;
      $(document).bind('click', me.killerFn);
    },

    disableKillerFn: function() {
      var me = this;
      $(document).unbind('click', me.killerFn);
    },

    killSuggestions: function() {
      var me = this;
      this.stopKillSuggestions();
      //TODO: FIGURE OUT HOW TO KILL THIS ON CLICK...took out me.hide() for now!
      //SOLN: ONLY ENABLE THIS WHEN YOU ARE NOT APPENDING INLINE!
      this.intervalId = window.setInterval(function() { me.hide(); me.stopKillSuggestions(); }, 300);

    },

    stopKillSuggestions: function() {
      window.clearInterval(this.intervalId);
    },

    onKeyPress: function(e) {
      if (this.disabled || !this.enabled) { return; }
      // return will exit the function
      // and event will not be prevented
      switch (e.keyCode) {
        case 27: //KEY_ESC:
          $("#"+e.srcElement.id).val(this.currentValue);
          this.hide();
          break;
        case 9: //KEY_TAB:
        case 13: //KEY_RETURN:
          if (this.selectedIndex === -1) {
            this.hide();
            return;
          }
          this.select(this.selectedIndex);
          if(e.keyCode === 9){ return; }
          break;
        case 38: //KEY_UP:
          this.moveUp();
          break;
        case 40: //KEY_DOWN:
          this.moveDown();
          break;
        default:
          return;
      }
      //e.stopImmediatePropagation();   SINCE WE'RE USING SEARCH IN FACEBOX DON'T STOP PROPAGATION!
      e.preventDefault();
    },

    refocusInput: function() {
      if(this.eventHandlers.pre){  //TODO: Change how all syncHandlers are regisetered so that pre...etc are not in a nested hash
        this.eventHandlers.pre['pre.autocomplete'](this.container, this.getQuery());
      }
      this.onValueChange();
    },

    onKeyUp: function(e) {
      if(this.disabled){ return; }
      switch (e.keyCode) {
        case 38: //KEY_UP:
        case 40: //KEY_DOWN:
          return;
      }
      clearInterval(this.onChangeInterval);
      if(this.eventHandlers.pre){  //TODO: Change how all syncHandlers are regisetered so that pre...etc are not in a nested hash
        this.eventHandlers.pre['pre.autocomplete'](this.container, this.getQuery());
      }
      if(this.options.overlay !== null){
        var parent = this.options.overlay.parent();
        var pHeight = parent.css('height');
        this.options.overlay.css('height', pHeight);
        this.options.overlay.show();
      }
      if (true){
        if (this.options.deferRequestBy > 0) { //TODO: INCLUDE CHECK TO SEE IF RESPONSE IS CACHED!
          // Defer lookup  when value changes very quickly:
          var me = this;
          this.onChangeInterval = setInterval(function() { me.onValueChange(); }, this.options.deferRequestBy);
        } else {
          this.onValueChange();
        }
      }
    },

    onValueChange: function() {
      clearInterval(this.onChangeInterval);
      this.currentValue = this.getCurrentValue();
      //construct query if watching multiple fields 
      var q = this.getQuery();
      this.selectedIndex = -1;
      if (this.ignoreValueChange) {
        this.ignoreValueChange = false;
        return;
      }
      if(typeof q === "object" && this.countInputChars(q) < this.options.minChars){
        this.hide();
      } else if (typeof q === "string" && q === '' || q.length < this.options.minChars) {
        this.hide();
      } else {
        this.getSuggestions(q);
      }
    },

    countInputChars: function(q){
      var keys = Object.keys(q);
      var chars = "";
      for(var i = 0; i < keys.length; i++){
        if(keys[i] === "sig"){continue;}  //TODO: figure out how to more generally handle 'sig'
        chars += q[keys[i]];
      }
      return chars.length;
    },
    //best way to construct a comparator for multiple inputs is just append all inputs onto a string
    getCurrentValue: function() {
      var str = "";
      this.inputs.each(function(){
        str += this.value
      });
      return str;
    },

    getQuery: function() {
      if(this.options.watch){
        var vals, name, value;
        vals = {};
        sig = ""
        this.inputs.each(function (){
          name = $.trim(this.name);
          value = $.trim(this.value);
          vals[name] = value;
          sig += value;
        });
        vals["sig"] = sig;
        return vals;
      }else {
        var d, arr, val;
        val = this.currentValue;
        d = this.options.delimiter;
        if (!d) { return $.trim(val); }
        arr = val.split(d);
        return $.trim(arr[arr.length - 1]);
      }
    },

    //TODO: Convert this so it works with multiple inputs!
    getSuggestionsLocal: function(q) {
      var ret, arr, len, val, i;
      arr = this.options.lookup;
      len = arr.suggestions.length;
      ret = { suggestions:[], data:[] };
      q = q.toLowerCase();
      for(var i=0; i< len; i++){
        val = arr.suggestions[i];
        if(val.toLowerCase().indexOf(q) === 0){
          ret.suggestions.push(val);
          ret.data.push(arr.data[i]);
        }
      }
      return ret;
    },
    
    getSuggestions: function(q) {
      var cr, me;
      var currentString = this.getCurrentValue(q);
      if(currentString.length == 0){
        this.hide();
        return;
      }
      cr = this.isLocal ? this.getSuggestionsLocal(q) : this.cachedResponse[currentString];
      if (cr && $.isArray(cr.suggestions)) {
        this.suggestions = cr.suggestions;
        this.data = cr.data;
        this.suggest();
      } else if (this.cachedResponse[currentString] === undefined){//(!this.isBadQuery(currentString)) {
        me = this;
        if(typeof q == "string"){
          me.options.params[me.options.queryWord] = q;
        }else{
          for(p in q){  //TODO: Verify this works in older browsers
            me.options.params[p] = q[p]
          }
        }
        $.ajax({
          url: this.serviceUrl, 
          data: me.options.params, 
          success: function(txt) { me.processResponse(txt); }, 
          dataType: 'text',
          xhrFields: {
            withCredentials: true
          },
          type: "POST"
        });
      }else{
        this.processThis(this.cachedResponse[currentString]);
      }
    },

    isBadQuery: function(q) {
      var i = this.badQueries.length;
      while (i--) {
        if (q.indexOf(this.badQueries[i]) === 0) { return true; }
      }
      return false;
    },

    hide: function() {
      this.enabled = false;
      this.selectedIndex = -1;
      this.container.hide();
      this.trigger("hide.autocomplete", [])
    },

    suggest: function() {
      this.container.hide().empty();
      if (this.suggestions.length === 0) {
        this.hide();
        return;
      }
      //TODO: Make fnFormatResult and fnBindElement use the new .register interface
      var me, len, div, f, v, i, s, mOver, mClick;
      me = this;
      len = this.suggestions.length;
      f = this.options.fnFormatResult;
      v = this.getQuery();
      mOver = function(xi) { return function() { me.activate(xi); }; };
      mClick = function(xi) { return function() { me.select(xi); }; };
      for (i = 0; i < len; i++) {
        if(this.eventHandlers.list && this.eventHandlers.list['list_'+i+'.autocomplete']) { //TODO: make name construction transparent
          fn = this.eventHandlers.list['list_'+i+'.autocomplete'];
          returnVal = fn(this.container, this.suggestions, this.data);
          if(returnVal != i){
            len = this.suggestions.length;
            continue;
          }
        }
        s = this.suggestions[i];
        div = $((me.selectedIndex === i ? '<div class="selected"' : '<div') + ' title="' + s + '">' + f(s, this.data[i], v) + '</div>');
        if(this.options.fnBindElement){
          this.options.fnBindElement(div, i, this);
        }else {
          div.mouseover(mOver(i));
          div.click(mClick(i));
        }
        this.container.append(div);
      }
      if(this.eventHandlers.list && this.eventHandlers.list['list_end.autocomplete']) {
        fn = this.eventHandlers.list['list_end.autocomplete'];
        fn(this.container, this.suggestions, this.data);
      }
      this.enabled = true;
      this.container.show();
      this.options.overlay.hide();
    },

    register: function(evnt, fn){
      type = evnt.split('_')[0];
      if(evnt.indexOf('autocomplete') == -1) {
        evnt = evnt + ".autocomplete"
      }
      syncHandle = function(ev){
        return ((ev.indexOf('list') != -1) || (ev.indexOf('pre') != -1)); //for now only list and pre events are synchronous
      }        
      if(!this.eventHandlers[type]){
        this.eventHandlers[type] = {};
      }
      if(!syncHandle(evnt)) {
        $(window).bind(evnt, fn);
      }else {
        this.eventHandlers[type][evnt] = fn;
      }
    },

    unregister: function(evnt, fn){
      type = evnt.split('_')[0];
      if(!this.eventHandlers[type]){
        this.eventHandlers[type] = {};
      }
      if(!syncHandle(evnt)) {
        $(window).unbind(evnt, fn);
      }else {
        delete this.eventHandlers[type][evnt];
      }    
    },

    processThis: function(response) { 
      this.suggestions = response.suggestions;
      this.data = response.data;
      this.secondaryData = response.secondaryData;
      this.trigger('state.autocomplete', [response.sstate]);
      this.suggest(); 
    },

    processResponse: function(text) {
      var response, q, currentQuery;

      try {
        response = eval('(' + text + ')');
      } catch (err) {return; }
      if (!$.isArray(response.data)) { response.data = []; }
      q = response.sig || response[this.options.queryWord];  //give priority to the sig property
      if(!this.options.noCache){
        this.cachedResponse[q] = response;
      }
      currentQuery = this.getQuery();
      //( ((typeof currentQuery === 'object') && (q === currentQuery.sig)) || ((typeof currentQuery === 'string') && (q === currentQuery)))
      if (q === (currentQuery.sig || currentQuery)) {
        if(this.options.overlay !== null){
          this.options.overlay.hide();
        }
        this.processThis(response);
      } 
    },

    activate: function(index) {
      var divs, activeItem;
      divs = this.container.children();
      // Clear previous selection:
      if (this.selectedIndex !== -1 && divs.length > this.selectedIndex) {
        this.removeSelected(this.selectedIndex);
      }
      this.selectedIndex = index;
      if (this.selectedIndex !== -1 && divs.length > this.selectedIndex) {
        activeItem = this.addSelected(this.selectedIndex);
      }
      this.trigger('activate.autocomplete', [this.container, this.suggestions, this.data, activeItem, index]);
      return activeItem;
    },

    deactivate: function(div, index) {
      div.className = '';
      if (this.selectedIndex === index) { this.selectedIndex = -1; }
    },

    select: function(i) {
      var selectedValue, f;
      selectedValue = this.suggestions[i];
      if(this.options.watch) { //if watching multiple elements just pass data to passed in function
        if(this.options.onSelect && $.isFunction(this.options.onSelect)){
          this.options.onSelect(selectedValue, this.data[i], this.options.watch);
        } else{
          //not sure what do in this case. probably should require onSelect to be defined?
        }
        this.ignoreValueChange = true;
        this.hide();
      } else if (selectedValue) {
        this.el.val(selectedValue);
        if (this.options.autoSubmit) {
          f = this.el.parents('form');
          if (f.length > 0) { f.get(0).submit(); }
        }
        this.ignoreValueChange = true;
        this.hide();
        this.onSelect(i);
      }
    },

    moveUp: function() {
      if (this.selectedIndex === -1) { return; }
      if (this.selectedIndex === 0) {
        this.removeSelected(0);
        this.selectedIndex = -1;
        this.el.val(this.currentValue);  //TODO: FIX EL NOW THAT IT CAN BE AN ARBITRARY ELEMENT!
        return;
      }
      this.adjustScroll(this.selectedIndex - 1);
    },

    addSelected: function(index) {
      div = $(this.container.children().get(index));
      children = div.children();
      div.addClass('selected');
      children.addClass('selected');   
      return div; 
    },

    removeSelected: function(index) {
      div = $(this.container.children().get(index));
      children = div.children();
      div.removeClass('selected');
      children.removeClass('selected');
      return div;
    },

    moveDown: function() {
      if (this.selectedIndex === (this.suggestions.length - 1)) { return; }
      this.adjustScroll(this.selectedIndex + 1);
    },

    adjustScroll: function(i) {
      var activeItem, offsetTop, upperBound, lowerBound;
      activeItem = this.activate(i);

      if(this.options.inline){
        offsetTop = activeItem.offset().top;
        upperBound = this.container.offset().top;
        lowerBound = upperBound + this.options.maxHeight - 25;
        if(offsetTop < upperBound){
          this.container.scrollTop(this.container.scrollTop() - (upperBound - offsetTop));
          this.trigger('acscroll.autocomplete', [this.container, this.suggestions, this.data, activeItem, i]);
        } else if (offsetTop > lowerBound) {
          this.container.scrollTop(this.container.scrollTop() + (offsetTop - lowerBound) + 25);
          this.trigger('acscroll.autocomplete', [this.container, this.suggestions, this.data, activeItem, i]);
        }
      }else{
        offsetTop = activeItem.offsetTop;
        upperBound = this.container.scrollTop();
        lowerBound = upperBound + this.options.maxHeight - 25;
        if (offsetTop < upperBound) {
          this.container.scrollTop(offsetTop);
          this.trigger('acscroll.autocomplete', [this.container, this.suggestions, this.data, activeItem, i]);
        } else if (offsetTop > lowerBound) {
          this.container.scrollTop(offsetTop - this.options.maxHeight + 25);
          this.trigger('acscroll.autocomplete', [this.container, this.suggestions, this.data, activeItem, i]);
        }
        this.el.val(this.getValue(this.suggestions[i]));
      }
    },

    onSelect: function(i) {
      var me, fn, s, d;
      me = this;
      fn = me.options.onSelect;
      s = me.suggestions[i];
      d = me.data[i];
      me.el.val(me.getValue(s));
      if ($.isFunction(fn)) { fn(s, d, me.el); }
    },
    
    getValue: function(value){
        var del, currVal, arr, me;
        me = this;
        del = me.options.delimiter;
        if (!del) { return value; }
        currVal = me.currentValue;
        arr = currVal.split(del);
        if (arr.length === 1) { return value; }
        return currVal.substr(0, currVal.length - arr[arr.length - 1].length) + value;
    },

    destroy: function(){
      //get rid of autocomplete container!
      $('[id*="AutocompleteCon"]').remove()
      if(this.cacheClearInterval != undefined){
        window.clearInterval(this.cacheClearInterval);
      }
    }

  };
}(jQuery));
});
