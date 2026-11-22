# Original Project Design

## Prompt #1
I'd like to build a very simple prototype of an image composition editor (somewhat similar to the older application "Microsoft Image Composer").  Please review AGENTS.md and provide feedback (we can edit it to be effective)--and its suggested project layout. Ask any questions.  Then I'd like you to Q&A me on the features and behavior of imbrica (the name of our image composition editor)

## Prompt #2

I mean more let's have a back and forth discussion.  Ask me one question and I'll answer and we'll go back and forth until we're ready to draft the plan.  

I'll start with an overview of what I'm thinking. I want to have an infinite canvas in which I can either paste images from the clipboard onto the canvas or can add an existing file from a directory. It basically creates an object or something from the image so that I'm able to do the following things with the image. I can drag the image around the infinite canvas to position it. I can scale the image. I can crop the image. And I should be able to group images together.

Grouping is a reversible effect. Flatten is another feature, and that actually combines the images in a permanent way so they become one image. At this stage, I don't intend to edit the image itself other than to crop it. But it would be nice to have some alignment tools . That is, if I select one image and another image, it aligns . Or I have options to align side by side, align them by top, align them by bottom, side by side was pushing them together, those kinds of orientation things.

### Prompt #3

It would be nice to have the way Image Composer did it, which is our own format that allows us to reopen the file that is the infinite canvas is saved as a file and the images and their locations whether they're grouped or not those are all saved in a format that we can then read back in to reproduce the canvas as it existed when the user saved it. Period. The other way that we could save a file is we would save whatever is on the canvas as a single PNG. So essentially it flattens all the images on the canvas into one image.

