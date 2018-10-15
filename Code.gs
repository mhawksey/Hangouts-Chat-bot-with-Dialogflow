function oneOffSetting() { 
  var file = DriveApp.getFilesByName('NAME_OF_YOUR_JSON_KEY_FILE.json').next();
  
  // used by all using this script
  var propertyStore = PropertiesService.getScriptProperties();
  // service account for our Dialogflow agent
  cGoa.GoaApp.setPackage (propertyStore , 
    cGoa.GoaApp.createServiceAccount (DriveApp , {
      packageName: 'dialogflow_serviceaccount',
      fileId: file.getId(),
      scopes : cGoa.GoaApp.scopesGoogleExpand (['cloud-platform']),
      service:'google_service'
    }));
}

/**
 * Detect message intent from Dialogflow Agent.
 * @param {String} message to find intent
 * @param {String} optLang optional language code
 * @return {object} JSON-formatted response
 */
function detectMessageIntent(message, optLang){
  // setting up calls to Dialogflow with Goa
  var goa = cGoa.GoaApp.createGoa ('dialogflow_serviceaccount',
                                   PropertiesService.getScriptProperties()).execute ();
  if (!goa.hasToken()) {
    throw 'something went wrong with goa - no token for calls';
  }
  // set our token 
  Dialogflow.setTokenService(function(){ return goa.getToken(); } );

  /* Preparing the Dialogflow.projects.agent.sessions.detectIntent call 
   * https://cloud.google.com/dialogflow-enterprise/docs/reference/rest/v2/projects.agent.sessions/detectIntent
   *
   * Building a queryInput request object https://cloud.google.com/dialogflow-enterprise/docs/reference/rest/v2/projects.agent.sessions/detectIntent#QueryInput
   * with a TextInput https://cloud.google.com/dialogflow-enterprise/docs/reference/rest/v2/projects.agent.sessions/detectIntent#textinput
  */
  var requestResource = {
    "queryInput": {
      "text": {
        "text": message,
        "languageCode": optLang || "en"
      }
    },
    "queryParams": {
      "timeZone": Session.getScriptTimeZone() // using script timezone but you may want to handle as a user setting
    }
  };

 /* Dialogflow.projectsAgentSessionsDetectIntent 
  * @param {string} session Required. The name of the session this query is sent to. Format:`projects/<Project ID>/agent/sessions/<Session ID>`.
  * up to the APIcaller to choose an appropriate session ID. It can be a random number orsome type of user identifier (preferably hashed)
  * In this example I'm using for the <Session ID>
  */
  // your Dialogflow project ID
  var PROJECT_ID = 'YOUR_DIALOGFLOW_PROJECT_ID'; // <- your Dialogflow proejct ID
  
  // using an URI encoded ActiveUserKey (non identifiable) https://developers.google.com/apps-script/reference/base/session#getTemporaryActiveUserKey()
  var SESSION_ID = encodeURIComponent(Session.getTemporaryActiveUserKey()); 
  
  var session = 'projects/'+PROJECT_ID+'/agent/sessions/'+SESSION_ID; // 
  var options = {};
  var intent = Dialogflow.projectsAgentSessionsDetectIntent(session, requestResource, options);
  return intent;
}

/**
 * Responds to an ADDED_TO_SPACE event in Hangouts Chat.
 * @param {object} event the event object from Hangouts Chat
 * @return {object} JSON-formatted response
 * @see https://developers.google.com/hangouts/chat/reference/message-formats/events
 */
function onAddToSpace(event) {
  console.info(event);
  var message = 'Thank you for adding me to ';
  if (event.space.type === 'DM') {
    message += 'a DM, ' + event.user.displayName + '!';
  } else {
    message += event.space.displayName;
  }
  return { text: message };
}

/**
 * Responds to a REMOVED_FROM_SPACE event in Hangouts Chat.
 * @param {object} event the event object from Hangouts Chat
 * @see https://developers.google.com/hangouts/chat/reference/message-formats/events
 */
function onRemoveFromSpace(event) {
  console.info(event);
  console.log('Bot removed from ', event.space.name);
}

var DEFAULT_IMAGE_URL = 'https://goo.gl/bMqzYS';
var HEADER = {
  header: {
    title : 'Attendance Bot',
    subtitle : 'Log your out-of-office',
    imageUrl : DEFAULT_IMAGE_URL
  }
};

/**
 * Creates a card-formatted response.
 * @param {object} widgets the UI components to send
 * @return {object} JSON-formatted response
 */
function createCardResponse(widgets) {
  return {
    cards: [HEADER, {
      sections: [{
        widgets: widgets
      }]
    }]
  };
}

// new REASONS object that has options for text title, inline text and icons 
var REASON = {
  'vacation': {title: 'Annual leave', inlineText: 'annual leave', imageUrl:  'https://goo.gl/EbgHuc' }, // Spa material icon
  'sick': {title: 'Off sick', inlineText: 'sick leave', imageUrl: 'https://goo.gl/mnZ37b'}, // Hospital material icon
  'lunch': {title: 'Lunch', inlineText: 'a lunch break', imageUrl: 'https://goo.gl/zEhek7'}, // Dining material icon
  'outofoffice': {title: 'Out of office', inlineText: 'an out-of-office', imageUrl: 'https://goo.gl/aXtqPZ'} // Event busy material icon 
};

/**
 * Responds to a MESSAGE event triggered in Hangouts Chat.
 * @param {object} event the event object from Hangouts Chat
 * @return {object} JSON-formatted response
 */
function onMessage(event) {
  console.info(event);
  var name = event.user.displayName;
  var userMessage = event.message.text;

  // detect intent of the message
  var intent = detectMessageIntent(userMessage);
  var intentParams = intent.queryResult.parameters;
  
  // if we have a reason show the Calendar and Gmail Out-of-Office buttons 
  if (intentParams.reason) {
    var reason = intentParams.reason;
    var widgets = createAddSetWidget(name, reason, intentParams);
  } else {
    // no reason detected so prompt user to select using agent prompt
    var fulfillmentMessages = intent.queryResult.fulfillmentMessages[0].text.text[0];
    // build a set of buttons based on REASON
    var reasonButtonObject = Object.keys(REASON).map(function (idx) {
      intentParams.reason = idx;
      return {
        textButton: {
          text: 'Set ' + REASON[idx].title,
          onClick: {
            action: {
              actionMethodName: 'reasonButtons',
              parameters: [{key: 'entities', value: JSON.stringify(intentParams)}]
            }
          }
        }
      }
    });
    var widgets = [{
      textParagraph: {
        text: 'Hello, ' + name + '.<br/>' + fulfillmentMessages
      }
    }, {
      buttons: reasonButtonObject
    }];
  }
  return createCardResponse(widgets);
}
/**
 * Create a card for setting events in Gmail or Calendar.
 * @param {string} name of the person adding the event
 * @param {string} reason of the event
 * @param {object} intentParams that contain any Dialogflow detected entities
 * @return {object} JSON-formatted response
 */
function createAddSetWidget(name, reason, intentParams) {
  // adjust the image and card subtitle based on reason
  HEADER.header.imageUrl = REASON[reason].imageUrl;
  HEADER.header.subtitle = 'Log your ' + REASON[reason].inlineText;
  
  // extract date objects from intent parameters returned by Dialogflow agent
  var dates = calcDateObject(intentParams);
  
  // build the Gmail/Calendar widget
  var widgets = [{
    textParagraph: {
      text: 'Hello, ' + name + '.<br/>It looks like you want to add ' + REASON[reason].inlineText + ' ' + dateRangeToString(dates) + '?'
    }
  }, {
    buttons: [{
      textButton: {
        text: 'Set ' + REASON[reason].inlineText + ' in Gmail',
        onClick: {
          action: {
            actionMethodName: 'turnOnAutoResponder',
            parameters: [{key: 'entities', value: JSON.stringify(intentParams)}]
          }
        }
      }
    }, {
      textButton: {
        text: 'Add ' + REASON[reason].inlineText + ' in Calendar',
        onClick: {
          action: {
            actionMethodName: 'blockOutCalendar',
            parameters: [{key: 'entities', value: JSON.stringify(intentParams)}]
          }
        }
      }
    }]
  }];
  return widgets;
}

/**
 * Responds to a CARD_CLICKED event triggered in Hangouts Chat.
 * @param {object} event the event object from Hangouts Chat
 * @return {object} JSON-formatted response
 * @see https://developers.google.com/hangouts/chat/reference/message-formats/events
 */
function onCardClick(event) {
  console.info(event);
  var intentParams = JSON.parse(event.action.parameters[0].value)
  var message = "I'm sorry; I'm not sure which button you clicked.";
  if (event.action.actionMethodName == 'turnOnAutoResponder') {
    return { text: turnOnAutoResponder(intentParams)};
  } else if (event.action.actionMethodName == 'blockOutCalendar') {
    return { text: blockOutCalendar(intentParams)};
  } else if (event.action.actionMethodName == 'reasonButtons') {
    // now we know the reason we can show the Gmail/Calendar card which includes existing parameters
    // returned from the Dialogflow agent
    var widgets = createAddSetWidget(event.user.displayName, intentParams.reason, intentParams);
    return createCardResponse(widgets);
  }
  return { text: message };
}
  

/**
 * Turns on the user's vacation response for today in Gmail.
 * @param {object} intentParams detected by Dialogflow agent
 * @return {string} message
 */
function turnOnAutoResponder(intentParams) {
  var dates = calcDateObject(intentParams);
  var title = REASON[intentParams.reason].title;
  var inlineText = REASON[intentParams.reason].inlineText;
  Gmail.Users.Settings.updateVacation({
    enableAutoReply: true,
    responseSubject: title,
    responseBodyHtml: "I'm on " + inlineText + " between " + dateRangeToString(dates) + ".<br><br><i>Created by Attendance Bot!</i>",
    restrictToContacts: true,
    restrictToDomain: true,
    startTime: dates.startDate.getTime(),
    endTime: dates.endDate.getTime()
  }, 'me');
  var message = "Added " + inlineText + " to Gmail for " + dateRangeToString(dates);
  return message;
}

/**
 * Places an all-day meeting on the user's Calendar.
 * @param {object} intentParams detected by Dialogflow agent
 * @return {string} message
 */
function blockOutCalendar(intentParams) {
  var dates = calcDateObject(intentParams);
  var title = REASON[intentParams.reason].title;
  var inlineText = REASON[intentParams.reason].inlineText;
  var options = {description:"I'm  on" + inlineText + " between " + dateRangeToString(dates) + ".<br><br><i>Created by Attendance Bot!</i>"};
  if (intentParams.reason == 'lunch' || intentParams.reason == 'outofoffice'){
    CalendarApp.createEvent(title, dates.startDate, dates.endDate, options);
  } else {
    CalendarApp.createAllDayEvent(title, dates.startDate, dates.endDate, options);
  }
  var message = "Added " + inlineText + " to Calendar for " + dateRangeToString(dates);
  return message;
}

var ONE_DAY_MILLIS = 24 * 60 * 60 * 1000;
/**
 * Returns a reformatted object array.
 * @param {object} entities returned by Dialogflow agent
 * @return {object} of calculated dates
 */
function calcDateObject(entities){
  var dates = {};
  // easy one - entities for date period
  if (entities['date-period']){
    dates.startDate = new Date(entities['date-period'].startDate);
    dates.endDate = new Date(entities['date-period'].endDate);
    return dates;
  } 
  // if no date period construct one
  if (entities['date']){
    dates.startDate = new Date(entities['date']);
  } else {
    dates.startDate = new Date();
  }
  if (entities['time']){
    var time = new Date(entities['time']); 
  } else {
    var time = new Date();
  }
  dates.startDate.setHours(time.getHours(), time.getMinutes()); 
  
  if (entities['reason'] == 'sick'){
    // if sick default to day
    dates.endDate = new Date(dates.startDate.getTime() + ONE_DAY_MILLIS);
  } else {
    // default to 30 mins
    dates.endDate = new Date(dates.startDate.getTime() + 30*60000);
  }
  if (entities['duration']){
    switch (entities['duration'].unit){
      case 'mo':
        dates.endDate = new Date(new Date().setMonth(dates.startDate.getMonth()+entities['duration'].amount));
        break;
      case 'wk':
        dates.endDate = new Date(dates.startDate.getTime() + entities['duration'].amount*7*ONE_DAY_MILLIS);
        break;
      case 'day':
        dates.endDate = new Date(dates.startDate.getTime() + entities['duration'].amount*ONE_DAY_MILLIS);
        break;
      case 'h':
        dates.endDate = new Date(dates.startDate.getTime() + entities['duration'].amount*60*60000);
        break;
      case 'm':
        dates.endDate = new Date(dates.startDate.getTime() + entities['duration'].amount*60000);
        break;
      default:
        throw "Can't handle duration";
        break;
    }
  }
  return dates;
}

/**
 * Returns a date range string.
 * @param {object} dates to turn into human readable format
 * @return {string} of date range
 */
function dateRangeToString(dates){
  var tz = Session.getScriptTimeZone();
  var format = "EEE d MMM h:mm a";
  return Utilities.formatDate(dates.startDate, tz, format) + " until "+ 
         Utilities.formatDate(dates.endDate, tz, format);

}